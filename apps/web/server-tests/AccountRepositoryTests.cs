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
    public void FifthFailedLogin_LocksForFifteenMinutes_AndResetClears()
    {
        var u = _repo.CreateUser(NewUser("carol"));
        for (var i = 1; i <= 4; i++)
        {
            var (f, until) = _repo.RecordFailedLogin(u.Id);
            Assert.Equal(i, f);
            Assert.Null(until);
        }

        var (failures, lockedUntil) = _repo.RecordFailedLogin(u.Id);
        Assert.Equal(5, failures);
        Assert.NotNull(lockedUntil);
        var delta = lockedUntil!.Value - DateTime.UtcNow;
        Assert.InRange(delta.TotalMinutes, 14, 15.1);
        Assert.NotNull(_repo.FindById(u.Id)!.LockedUntil);

        _repo.ResetFailures(u.Id);
        var after = _repo.FindById(u.Id)!;
        Assert.Equal(0, after.FailedLogins);
        Assert.Null(after.LockedUntil);
    }

    [Fact]
    public void SetDisabled_And_UpdateCredentials_Persist()
    {
        var u = _repo.CreateUser(NewUser("dave"));
        _repo.SetDisabled(u.Id, true);
        Assert.True(_repo.FindById(u.Id)!.Disabled);
        _repo.SetDisabled(u.Id, false);
        Assert.False(_repo.FindById(u.Id)!.Disabled);

        _repo.UpdateCredentials(u.Id, "bmV3c2FsdA==", 700000, "bmV3aGFzaA==", "bmV3d3ByaXY=", "bmV3d2NvbnQ=");
        var r = _repo.FindById(u.Id)!;
        Assert.Equal("bmV3c2FsdA==", r.Salt);
        Assert.Equal(700000, r.Iterations);
        Assert.Equal("bmV3aGFzaA==", r.AuthHash);
        Assert.Equal("bmV3d3ByaXY=", r.WrappedPrivateKey);
        Assert.Equal("bmV3d2NvbnQ=", r.WrappedContainerKey);
        Assert.Equal("cHVi", r.PublicKey); // public key unchanged
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
