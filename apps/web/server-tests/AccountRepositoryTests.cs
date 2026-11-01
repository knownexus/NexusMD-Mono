using Xunit;
using Microsoft.Extensions.Configuration;
using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Models;
using NexusMDWeb.Api.Services.Auth;

namespace NexusMDWeb.Tests;

/// <summary>Unit tests for the account store, password hasher and token service (no HTTP host).</summary>
public sealed class AccountRepositoryTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"nexusmd-acct-{Guid.NewGuid():N}");
    private readonly AccountRepository _repo;

    public AccountRepositoryTests()
    {
        Directory.CreateDirectory(_dir);
        _repo = new AccountRepository(Config(("Accounts:DbPath", Path.Combine(_dir, "accounts.db"))));
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
    }

    private static IConfiguration Config(params (string, string?)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Item1, v.Item2)))
            .Build();

    private static NewUser NewUser(string username, string role = "user") =>
        new(username, role, "c2FsdA==", 600000, "aGFzaA==", "cHVi", "d3ByaXY=", "d2NvbnQ=");

    private string DbFile => Path.Combine(_dir, "accounts.db");

    private void Sql(string sql, params (string, object)[] args)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={DbFile}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        cmd.ExecuteNonQuery();
    }

    private long Scalar(string sql, params (string, object)[] args)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={DbFile}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ---- PasswordHasher ------------------------------------------------------------

    [Fact]
    public void Hasher_RoundTrip_VerifiesAndRejectsWrongKey()
    {
        var key = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
        var other = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
        var stored = PasswordHasher.Hash(key);

        Assert.True(PasswordHasher.Verify(key, stored));
        Assert.False(PasswordHasher.Verify(other, stored));
        Assert.False(PasswordHasher.Verify(key, "garbage"));
        Assert.True(int.Parse(stored.Split('.')[0]) >= 210000);
        Assert.Equal(3, stored.Split('.').Length);
    }

    [Fact]
    public void Hasher_SameKeyTwice_ProducesDifferentHashes()
    {
        var key = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
        Assert.NotEqual(PasswordHasher.Hash(key), PasswordHasher.Hash(key));
    }

    // ---- TokenService --------------------------------------------------------------

    [Fact]
    public void Tokens_AccessTokenCarriesClaimsAndLifetime()
    {
        var env = new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = "Production" };
        var svc = new TokenService(Config(("Jwt:SigningKey", new string('k', 64)), ("Jwt:AccessMinutes", "10")), env);
        var user = _repo.CreateUser(NewUser("Alice", "admin"));

        var (token, expiresIn) = svc.IssueAccess(user);

        Assert.Equal(600, expiresIn);
        var jwt = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal(user.Id, jwt.Claims.First(c => c.Type == "sub").Value);
        Assert.Equal("admin", jwt.Claims.First(c => c.Type == "role").Value);
        Assert.Equal("Alice", jwt.Claims.First(c => c.Type == "unique_name").Value);
        Assert.Equal("nexusmd", jwt.Issuer);
    }

    [Fact]
    public void Tokens_RefreshTokenHashMatchesHashRefresh_AndTokensAreUnique()
    {
        var env = new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = "Production" };
        var svc = new TokenService(Config(("Jwt:SigningKey", new string('k', 64))), env);

        var (t1, h1) = svc.NewRefreshToken();
        var (t2, _) = svc.NewRefreshToken();

        Assert.NotEqual(t1, t2);
        Assert.Equal(h1, svc.HashRefresh(t1));
        Assert.Equal(64, h1.Length);
        Assert.NotEqual(t1, h1);
    }

    // ---- Users ---------------------------------------------------------------------

    [Fact]
    public void CreateUser_DuplicateUsernameIsCaseInsensitive()
    {
        Assert.False(_repo.AnyUser());
        var alice = _repo.CreateUser(NewUser("Alice"));
        Assert.True(_repo.AnyUser());

        Assert.Throws<DuplicateUsernameException>(() => _repo.CreateUser(NewUser("alice")));
        Assert.Equal(alice.Id, _repo.FindByUsername("ALICE")!.Id);
        Assert.Equal("Alice", _repo.FindById(alice.Id)!.Username);
        Assert.Null(_repo.FindByUsername("bob"));
    }

    [Fact]
    public void FifthReservedAttempt_LocksForFifteenMinutes_AndResetClears()
    {
        var u = _repo.CreateUser(NewUser("carol"));
        for (var i = 1; i <= 4; i++)
        {
            var (ok, f, until) = _repo.TryReserveLoginAttempt(u.Id);
            Assert.True(ok);
            Assert.Equal(i, f);
            Assert.Null(until);
        }

        var (allowed, failures, lockedUntil) = _repo.TryReserveLoginAttempt(u.Id);
        Assert.True(allowed); // the attempt that reaches the limit is still verified
        Assert.Equal(5, failures);
        Assert.NotNull(lockedUntil);
        var delta = lockedUntil!.Value - DateTime.UtcNow;
        Assert.InRange(delta.TotalMinutes, 14, 15.1);
        Assert.NotNull(_repo.FindById(u.Id)!.LockedUntil);

        var (allowed6, _, _) = _repo.TryReserveLoginAttempt(u.Id);
        Assert.False(allowed6);

        _repo.ResetFailures(u.Id);
        var after = _repo.FindById(u.Id)!;
        Assert.Equal(0, after.FailedLogins);
        Assert.Null(after.LockedUntil);
    }

    [Fact]
    public void ResetFailuresIfCount_OnlyResetsWhenTheCountStillMatches()
    {
        var u = _repo.CreateUser(NewUser("cond1"));
        _repo.TryReserveLoginAttempt(u.Id);                        // count 1
        var (_, second, _) = _repo.TryReserveLoginAttempt(u.Id);   // count 2

        _repo.ResetFailuresIfCount(u.Id, 1);                       // stale: a later attempt exists
        Assert.Equal(2, _repo.FindById(u.Id)!.FailedLogins);

        _repo.ResetFailuresIfCount(u.Id, second);
        Assert.Equal(0, _repo.FindById(u.Id)!.FailedLogins);
    }

    [Fact]
    public void ConcurrentReservations_AllowExactlyFive()
    {
        var u = _repo.CreateUser(NewUser("conc1"));
        var results = new (bool allowed, int failures, DateTime? until)[24];
        Parallel.For(0, results.Length, i => results[i] = _repo.TryReserveLoginAttempt(u.Id));

        Assert.Equal(5, results.Count(r => r.allowed));
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, results.Where(r => r.allowed).Select(r => r.failures).OrderBy(x => x));
        Assert.Equal(5, _repo.FindById(u.Id)!.FailedLogins);
    }

    [Fact]
    public void CreateFirstUser_OnlyOneWins_EvenWhenRacing()
    {
        var results = new UserRecord?[8];
        Parallel.For(0, results.Length, i => results[i] = _repo.CreateFirstUser(NewUser("first" + i, "admin")));

        Assert.Single(results, r => r != null);
        Assert.Single(_repo.ListUsers());
        Assert.Null(_repo.CreateFirstUser(NewUser("late", "admin")));
    }

    [Fact]
    public void CreateSessionIfCredentialsCurrent_RefusesAStaleAuthHash()
    {
        var u = _repo.CreateUser(NewUser("stale1"));
        _repo.ChangeCredentials(u.Id, "bmV3c2FsdA==", 700000, "new-hash", "d3ByaXY=", "d2NvbnQ=", "rh0");

        Assert.Null(_repo.CreateSessionIfCredentialsCurrent(u.Id, "rh1", "aGFzaA=="));  // old hash
        Assert.False(_repo.RotateSession("rh1", "rh2").Ok);
        Assert.NotNull(_repo.CreateSessionIfCredentialsCurrent(u.Id, "rh3", "new-hash"));
    }

    [Fact]
    public void ChangeCredentials_UpdatesRevokesEverythingAndCreatesOneSession()
    {
        var u = _repo.CreateUser(NewUser("chg1"));
        var s1 = _repo.CreateSession(u.Id, "a1");
        var s2 = _repo.CreateSession(u.Id, "a2");
        var other = _repo.CreateUser(NewUser("chg-other"));
        var so = _repo.CreateSession(other.Id, "o1");
        for (var i = 0; i < 3; i++) _repo.TryReserveLoginAttempt(u.Id);

        var sid = _repo.ChangeCredentials(u.Id, "bmV3c2FsdA==", 700000, "bmV3aGFzaA==", "bmV3d3ByaXY=", "bmV3d2NvbnQ=", "fresh");

        Assert.False(_repo.SessionExists(s1));
        Assert.False(_repo.SessionExists(s2));
        Assert.True(_repo.SessionExists(sid));
        Assert.True(_repo.SessionExists(so));
        var r = _repo.FindById(u.Id)!;
        Assert.Equal("bmV3c2FsdA==", r.Salt);
        Assert.Equal(700000, r.Iterations);
        Assert.Equal("bmV3aGFzaA==", r.AuthHash);
        Assert.Equal("bmV3d3ByaXY=", r.WrappedPrivateKey);
        Assert.Equal("bmV3d2NvbnQ=", r.WrappedContainerKey);
        Assert.Equal("cHVi", r.PublicKey); // public key unchanged
        Assert.Equal(0, r.FailedLogins);
        Assert.True(_repo.RotateSession("fresh", "fresh2").Ok);
    }

    [Fact]
    public void ChangeCredentials_WithAStaleExpectedHash_ChangesNothing()
    {
        var u = _repo.CreateUser(NewUser("chg2"));
        var live = _repo.CreateSession(u.Id, "keep");

        var sid = _repo.ChangeCredentials(u.Id, "bmV3c2FsdA==", 700000, "x", "d3ByaXY=", "d2NvbnQ=", "fresh", expectedAuthHash: "not-the-hash");

        Assert.Null(sid);
        Assert.True(_repo.SessionExists(live));
        Assert.Equal("aGFzaA==", _repo.FindById(u.Id)!.AuthHash);
        Assert.NotNull(_repo.ChangeCredentials(u.Id, "bmV3c2FsdA==", 700000, "x", "d3ByaXY=", "d2NvbnQ=", "fresh", expectedAuthHash: "aGFzaA=="));
    }

    [Fact]
    public void SetDisabled_Persists()
    {
        var u = _repo.CreateUser(NewUser("dave"));
        _repo.SetDisabled(u.Id, true);
        Assert.True(_repo.FindById(u.Id)!.Disabled);
        _repo.SetDisabled(u.Id, false);
        Assert.False(_repo.FindById(u.Id)!.Disabled);
    }

    // ---- Invites -------------------------------------------------------------------

    [Fact]
    public void Invite_RedeemsOnce()
    {
        var admin = _repo.CreateUser(NewUser("admin", "admin"));
        var (id, code) = _repo.CreateInvite(admin.Id, TimeSpan.FromHours(1));

        Assert.True(_repo.RedeemInvite(code));
        Assert.False(_repo.RedeemInvite(code));
        Assert.False(_repo.RedeemInvite("not-a-code"));
        Assert.Contains(_repo.ListInvites(), i => i.Id == id && i.RedeemedAt != null);
    }

    [Fact]
    public void Invite_ExpiredOrRevokedCannotBeRedeemed()
    {
        var admin = _repo.CreateUser(NewUser("admin", "admin"));
        var (_, expired) = _repo.CreateInvite(admin.Id, TimeSpan.FromSeconds(-1));
        Assert.False(_repo.RedeemInvite(expired));

        var (revokedId, revoked) = _repo.CreateInvite(admin.Id, TimeSpan.FromHours(1));
        Assert.True(_repo.RevokeInvite(revokedId));
        Assert.False(_repo.RedeemInvite(revoked));
        Assert.DoesNotContain(_repo.ListInvites(), i => i.Id == revokedId);
    }

    [Fact]
    public void Invite_StoresOnlyHashOfCode()
    {
        var admin = _repo.CreateUser(NewUser("admin", "admin"));
        var (_, code) = _repo.CreateInvite(admin.Id, TimeSpan.FromHours(1));

        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(_dir, "accounts.db")}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT CodeHash FROM Invites";
        var stored = (string)cmd.ExecuteScalar()!;
        Assert.NotEqual(code, stored);
        Assert.Equal(64, stored.Length);
    }

    // ---- Sessions ------------------------------------------------------------------

    [Fact]
    public void RotateSession_Rotates_ThenReuseOfOldHashRevokesSession()
    {
        var u = _repo.CreateUser(NewUser("erin"));
        var sid = _repo.CreateSession(u.Id, "hash-1");

        var r1 = _repo.RotateSession("hash-1", "hash-2");
        Assert.True(r1.Ok);
        Assert.False(r1.Reused);
        Assert.Equal(u.Id, r1.UserId);

        // Replay the already-rotated token: reuse detected, session revoked.
        var replay = _repo.RotateSession("hash-1", "hash-3");
        Assert.False(replay.Ok);
        Assert.True(replay.Reused);
        Assert.Equal(u.Id, replay.UserId);

        // The legitimate successor token no longer works either.
        var legit = _repo.RotateSession("hash-2", "hash-4");
        Assert.False(legit.Ok);
        Assert.False(_repo.SessionExists(sid));
    }

    [Fact]
    public void RotateSession_ReuseOfTokenTwoGenerationsOldIsAlsoDetected()
    {
        var u = _repo.CreateUser(NewUser("frank"));
        _repo.CreateSession(u.Id, "a");
        Assert.True(_repo.RotateSession("a", "b").Ok);
        Assert.True(_repo.RotateSession("b", "c").Ok);

        var replay = _repo.RotateSession("a", "x");
        Assert.True(replay.Reused);
        Assert.False(_repo.RotateSession("c", "d").Ok);
    }

    [Fact]
    public void RotateSession_UnknownHash_IsNotOkAndNotReused()
    {
        var r = _repo.RotateSession("nope", "new");
        Assert.False(r.Ok);
        Assert.False(r.Reused);
        Assert.Null(r.UserId);
    }

    [Fact]
    public void RevokeAllSessions_KeepsOnlyTheExcepted()
    {
        var u = _repo.CreateUser(NewUser("gina"));
        var other = _repo.CreateUser(NewUser("hank"));
        var keep = _repo.CreateSession(u.Id, "k1");
        var drop1 = _repo.CreateSession(u.Id, "k2");
        var drop2 = _repo.CreateSession(u.Id, "k3");
        var unrelated = _repo.CreateSession(other.Id, "k4");

        _repo.RevokeAllSessions(u.Id, keep);

        Assert.True(_repo.SessionExists(keep));
        Assert.False(_repo.SessionExists(drop1));
        Assert.False(_repo.SessionExists(drop2));
        Assert.True(_repo.SessionExists(unrelated));
        Assert.False(_repo.RotateSession("k2", "z").Ok);
        Assert.True(_repo.RotateSession("k1", "k1b").Ok);

        _repo.RevokeAllSessions(u.Id);
        Assert.False(_repo.SessionExists(keep));
    }

    [Fact]
    public void RevokeSession_MakesRefreshTokenUnusable()
    {
        var u = _repo.CreateUser(NewUser("ivy"));
        var sid = _repo.CreateSession(u.Id, "r1");
        _repo.RevokeSession(sid);
        Assert.False(_repo.RotateSession("r1", "r2").Ok);
    }

    // ---- Fix round 1 ---------------------------------------------------------------

    private UserRecord LockedUser(string name)
    {
        var u = _repo.CreateUser(NewUser(name));
        for (var i = 0; i < 5; i++) _repo.TryReserveLoginAttempt(u.Id);
        Assert.NotNull(_repo.FindById(u.Id)!.LockedUntil);
        return u;
    }

    [Fact]
    public void Lockout_AfterExpiry_StartsAFreshCount()
    {
        var u = LockedUser("lock1");
        Sql("UPDATE Users SET LockedUntil=$p WHERE Id=$id", ("$p", NowMs() - 1000), ("$id", u.Id));

        var (allowed, failures, until) = _repo.TryReserveLoginAttempt(u.Id);

        Assert.True(allowed);
        Assert.Equal(1, failures);
        Assert.Null(until);
        var r = _repo.FindById(u.Id)!;
        Assert.Equal(1, r.FailedLogins);
        Assert.Null(r.LockedUntil);
    }

    [Fact]
    public void Lockout_FailureWhileLocked_DoesNotIncrementOrExtend()
    {
        var u = LockedUser("lock2");
        var before = _repo.FindById(u.Id)!;

        var (allowed, failures, until) = _repo.TryReserveLoginAttempt(u.Id);

        Assert.False(allowed);
        Assert.Equal(5, failures);
        Assert.Equal(before.LockedUntil, until);
        var after = _repo.FindById(u.Id)!;
        Assert.Equal(5, after.FailedLogins);
        Assert.Equal(before.LockedUntil, after.LockedUntil);
    }

    [Fact]
    public void Session_ExpiredCannotRotate_AndIsNotActive()
    {
        var u = _repo.CreateUser(NewUser("exp1"));
        var sid = _repo.CreateSession(u.Id, "e1");
        Assert.True(_repo.SessionExists(sid));
        Sql("UPDATE Sessions SET ExpiresAt=$p WHERE Id=$id", ("$p", NowMs() - 1000), ("$id", sid));

        Assert.False(_repo.SessionExists(sid));
        var r = _repo.RotateSession("e1", "e2");
        Assert.False(r.Ok);
        Assert.False(r.Reused);
    }

    [Fact]
    public void Session_IdleExpiryIs30Days_AndRotationExtendsIt()
    {
        var u = _repo.CreateUser(NewUser("exp2"));
        var sid = _repo.CreateSession(u.Id, "x1");
        var thirtyDays = (long)TimeSpan.FromDays(30).TotalMilliseconds;
        var created = Scalar("SELECT ExpiresAt FROM Sessions WHERE Id=$id", ("$id", sid));
        Assert.InRange(created - NowMs(), thirtyDays - 60_000, thirtyDays + 1000);

        Sql("UPDATE Sessions SET ExpiresAt=$p WHERE Id=$id", ("$p", NowMs() + 3_600_000), ("$id", sid));
        Assert.True(_repo.RotateSession("x1", "x2").Ok);

        var extended = Scalar("SELECT ExpiresAt FROM Sessions WHERE Id=$id", ("$id", sid));
        Assert.InRange(extended - NowMs(), thirtyDays - 60_000, thirtyDays + 1000);
    }

    [Fact]
    public void RevokedSession_RetiredRowsAreDeleted()
    {
        var u = _repo.CreateUser(NewUser("ret1"));
        var s1 = _repo.CreateSession(u.Id, "a1");
        Assert.True(_repo.RotateSession("a1", "a2").Ok);
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM RetiredRefresh WHERE SessionId=$s", ("$s", s1)));
        _repo.RevokeSession(s1);
        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM RetiredRefresh WHERE SessionId=$s", ("$s", s1)));

        var s2 = _repo.CreateSession(u.Id, "b1");
        Assert.True(_repo.RotateSession("b1", "b2").Ok);
        _repo.RevokeAllSessions(u.Id);
        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM RetiredRefresh WHERE SessionId=$s", ("$s", s2)));

        var s3 = _repo.CreateSession(u.Id, "c1");
        Assert.True(_repo.RotateSession("c1", "c2").Ok);
        Assert.True(_repo.RotateSession("c1", "c3").Reused); // reuse revokes the session
        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM RetiredRefresh WHERE SessionId=$s", ("$s", s3)));
    }

    [Fact]
    public void Rotation_PurgesExpiredSessionsAndTheirRetiredRows()
    {
        var u = _repo.CreateUser(NewUser("purge"));
        var old = _repo.CreateSession(u.Id, "p1");
        Assert.True(_repo.RotateSession("p1", "p2").Ok);
        Sql("UPDATE Sessions SET ExpiresAt=$p WHERE Id=$id", ("$p", NowMs() - 1000), ("$id", old));
        var live = _repo.CreateSession(u.Id, "q1");

        Assert.True(_repo.RotateSession("q1", "q2").Ok);

        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM Sessions WHERE Id=$id", ("$id", old)));
        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM RetiredRefresh WHERE SessionId=$id", ("$id", old)));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM RetiredRefresh WHERE SessionId=$id", ("$id", live)));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM pragma_index_list('RetiredRefresh') WHERE name='IX_RetiredRefresh_SessionId'"));
    }

    [Fact]
    public void SetDisabled_RevokesAllSessions()
    {
        var u = _repo.CreateUser(NewUser("dis1"));
        var other = _repo.CreateUser(NewUser("dis2"));
        var s1 = _repo.CreateSession(u.Id, "d1");
        var s2 = _repo.CreateSession(u.Id, "d2");
        var so = _repo.CreateSession(other.Id, "d3");

        _repo.SetDisabled(u.Id, true);

        Assert.False(_repo.SessionExists(s1));
        Assert.False(_repo.SessionExists(s2));
        Assert.True(_repo.SessionExists(so));
        Assert.Equal(2, Scalar("SELECT COUNT(*) FROM Sessions WHERE UserId=$u AND RevokedAt IS NOT NULL", ("$u", u.Id)));

        // Re-enabling does not resurrect the sessions.
        _repo.SetDisabled(u.Id, false);
        Assert.False(_repo.SessionExists(s1));
        Assert.False(_repo.RotateSession("d1", "d1b").Ok);
    }

    [Fact]
    public void DisabledOwner_BlocksRotationAndSessionExists_EvenIfSessionWasNotRevoked()
    {
        var u = _repo.CreateUser(NewUser("dis3"));
        var sid = _repo.CreateSession(u.Id, "z1");
        Sql("UPDATE Users SET Disabled=1 WHERE Id=$id", ("$id", u.Id)); // bypass SetDisabled

        Assert.False(_repo.SessionExists(sid));
        Assert.False(_repo.RotateSession("z1", "z2").Ok);
    }

    [Fact]
    public void CreateUser_OtherConstraintFailuresPropagate_NotMappedToDuplicate()
    {
        // A null role never reaches SQLite (parameter binding throws first), so provoke a different
        // constraint failure (SQLITE_CONSTRAINT_TRIGGER, 1811) with a trigger.
        Sql("CREATE TRIGGER trg_reject BEFORE INSERT ON Users WHEN NEW.Username='boom' BEGIN SELECT RAISE(ABORT,'rejected'); END");

        var ex = Record.Exception(() => _repo.CreateUser(NewUser("boom")));

        Assert.IsType<Microsoft.Data.Sqlite.SqliteException>(ex);
        Assert.Equal(1811, ((Microsoft.Data.Sqlite.SqliteException)ex!).SqliteExtendedErrorCode);
        Assert.False(_repo.AnyUser());
    }

    [Fact]
    public void CreateUserFromInvite_CreatesUserAndConsumesInviteOnce()
    {
        var admin = _repo.CreateUser(NewUser("admin", "admin"));
        var (_, code) = _repo.CreateInvite(admin.Id, TimeSpan.FromHours(1));

        var created = _repo.CreateUserFromInvite(code, NewUser("newbie"));

        Assert.Equal("newbie", created.Username);
        Assert.Equal("user", created.Role);
        Assert.NotNull(_repo.FindByUsername("newbie"));
        Assert.Throws<InvalidInviteException>(() => _repo.CreateUserFromInvite(code, NewUser("second")));
        Assert.Null(_repo.FindByUsername("second"));
        Assert.False(_repo.RedeemInvite(code));
    }

    [Fact]
    public void CreateUserFromInvite_DuplicateUsernameLeavesInviteRedeemable()
    {
        var admin = _repo.CreateUser(NewUser("admin", "admin"));
        var (_, code) = _repo.CreateInvite(admin.Id, TimeSpan.FromHours(1));

        Assert.Throws<DuplicateUsernameException>(() => _repo.CreateUserFromInvite(code, NewUser("ADMIN")));

        var created = _repo.CreateUserFromInvite(code, NewUser("someone-else"));
        Assert.Equal("someone-else", created.Username);
    }

    [Fact]
    public void CreateUserFromInvite_RejectsUnknownExpiredAndRevokedInvites()
    {
        var admin = _repo.CreateUser(NewUser("admin", "admin"));
        var (_, expired) = _repo.CreateInvite(admin.Id, TimeSpan.FromSeconds(-1));
        var (revId, revoked) = _repo.CreateInvite(admin.Id, TimeSpan.FromHours(1));
        _repo.RevokeInvite(revId);

        Assert.Throws<InvalidInviteException>(() => _repo.CreateUserFromInvite("NOPE", NewUser("u1")));
        Assert.Throws<InvalidInviteException>(() => _repo.CreateUserFromInvite(expired, NewUser("u2")));
        Assert.Throws<InvalidInviteException>(() => _repo.CreateUserFromInvite(revoked, NewUser("u3")));
        Assert.Null(_repo.FindByUsername("u1"));
        Assert.Null(_repo.FindByUsername("u2"));
        Assert.Null(_repo.FindByUsername("u3"));
    }

    [Fact]
    public void Username_ComposedAndDecomposedFormsConflict()
    {
        var composed = "René";          // e with acute, precomposed
        var decomposed = "René";       // e + combining acute
        _repo.CreateUser(NewUser(composed));

        Assert.Throws<DuplicateUsernameException>(() => _repo.CreateUser(NewUser(decomposed)));
        Assert.NotNull(_repo.FindByUsername(decomposed.ToUpperInvariant()));
        Assert.Equal(composed, _repo.FindByUsername(decomposed)!.Username);
    }

    [Fact]
    public async Task RotateSession_ConcurrentSameOldHash_ExactlyOneSucceeds()
    {
        var u = _repo.CreateUser(NewUser("race"));
        _repo.CreateSession(u.Id, "old");

        var tasks = Enumerable.Range(0, 8)
            .Select(i => Task.Run(() => _repo.RotateSession("old", $"new-{i}")))
            .ToArray();
        var results = await Task.WhenAll(tasks);

        Assert.Equal(1, results.Count(r => r.Ok));
        Assert.All(results.Where(r => !r.Ok), r => Assert.True(r.Reused || r.UserId == null));
    }

    // ---- Shared JWT key rule -------------------------------------------------------

    [Fact]
    public void JwtKeyResolver_EnforcesLengthAndEnvironmentRules()
    {
        var prod = new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = "Production" };
        var dev = new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = "Development" };

        Assert.Throws<InvalidOperationException>(() => JwtKeyResolver.Resolve(Config(), prod));
        Assert.Throws<InvalidOperationException>(() => JwtKeyResolver.Resolve(Config(("Jwt:SigningKey", "short")), dev));
        Assert.Equal(new string('k', 32), JwtKeyResolver.Resolve(Config(("Jwt:SigningKey", new string('k', 32))), prod));
        var ephemeral = JwtKeyResolver.Resolve(Config(), dev);
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(ephemeral) >= 32);
        Assert.Equal(ephemeral, JwtKeyResolver.Resolve(Config(), dev));
    }
}
