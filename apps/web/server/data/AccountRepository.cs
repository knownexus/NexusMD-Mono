using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using NexusMDWeb.Api.Models;

namespace NexusMDWeb.Api.Data;

/// <summary>
/// SQLite store for accounts, invites, sessions, devices and encrypted items.
/// Holds only client-produced opaque blobs and a server-side hash of the auth key:
/// never a vault key, container key or plaintext. Timestamps are Unix milliseconds (UTC).
/// </summary>
public class AccountRepository
{
    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private const string UserColumns =
        "Id,Username,Role,Salt,Iterations,AuthHash,PublicKey,WrappedPrivateKey,WrappedContainerKey,Disabled,FailedLogins,LockedUntil,CreatedAt";

    private readonly string _connectionString;

    public AccountRepository(IConfiguration config)
    {
        var dbPath = config["Accounts:DbPath"] ?? "accounts.db";
        if (!Path.IsPathRooted(dbPath))
            dbPath = Path.Combine(AppContext.BaseDirectory, dbPath);
        _connectionString = $"Data Source={dbPath}";
        Initialise();
    }

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private void Initialise()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS Users (
                Id                  TEXT    PRIMARY KEY,
                Username            TEXT    NOT NULL,
                UsernameKey         TEXT    NOT NULL UNIQUE,
                Role                TEXT    NOT NULL,
                Salt                TEXT    NOT NULL,
                Iterations          INTEGER NOT NULL,
                AuthHash            TEXT    NOT NULL,
                PublicKey           TEXT    NOT NULL,
                WrappedPrivateKey   TEXT    NOT NULL,
                WrappedContainerKey TEXT    NOT NULL,
                Disabled            INTEGER NOT NULL DEFAULT 0,
                FailedLogins        INTEGER NOT NULL DEFAULT 0,
                LockedUntil         INTEGER,
                CreatedAt           INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Invites (
                Id         TEXT    PRIMARY KEY,
                CodeHash   TEXT    NOT NULL UNIQUE,
                CreatedBy  TEXT    NOT NULL,
                CreatedAt  INTEGER NOT NULL,
                ExpiresAt  INTEGER NOT NULL,
                RedeemedAt INTEGER,
                RevokedAt  INTEGER
            );
            CREATE TABLE IF NOT EXISTS Sessions (
                Id          TEXT    PRIMARY KEY,
                UserId      TEXT    NOT NULL,
                RefreshHash TEXT    NOT NULL UNIQUE,
                CreatedAt   INTEGER NOT NULL,
                RotatedAt   INTEGER,
                RevokedAt   INTEGER
            );
            CREATE INDEX IF NOT EXISTS IX_Sessions_UserId ON Sessions (UserId);
            -- Hashes of refresh tokens that were already rotated; replaying one revokes its session.
            CREATE TABLE IF NOT EXISTS RetiredRefresh (
                Hash      TEXT    PRIMARY KEY,
                SessionId TEXT    NOT NULL,
                RetiredAt INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Devices (
                Id        TEXT    PRIMARY KEY,
                UserId    TEXT    NOT NULL,
                Name      TEXT    NOT NULL,
                Platform  TEXT    NOT NULL,
                Prefs     TEXT,
                Revision  INTEGER NOT NULL DEFAULT 0,
                CreatedAt INTEGER NOT NULL,
                UpdatedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_Devices_UserId ON Devices (UserId);
            CREATE TABLE IF NOT EXISTS Items (
                UserId     TEXT    NOT NULL,
                Id         TEXT    NOT NULL,
                Revision   INTEGER NOT NULL,
                Cursor     INTEGER NOT NULL,
                Ciphertext TEXT    NOT NULL,
                Deleted    INTEGER NOT NULL DEFAULT 0,
                UpdatedAt  INTEGER NOT NULL,
                PRIMARY KEY (UserId, Id)
            );
            CREATE INDEX IF NOT EXISTS IX_Items_Cursor ON Items (UserId, Cursor);";
        cmd.ExecuteNonQuery();
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static long ToMs(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
    private static DateTime FromMs(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
    private static string Sha256Hex(string s) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    private static string UsernameKey(string username) => username.Trim().ToLowerInvariant();

    // ---- Users -------------------------------------------------------------------------

    public bool AnyUser()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT EXISTS(SELECT 1 FROM Users)";
        return Convert.ToInt64(cmd.ExecuteScalar()) == 1;
    }

    public UserRecord CreateUser(NewUser u)
    {
        var id = Guid.NewGuid().ToString("N");
        var now = Now();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO Users
            (Id,Username,UsernameKey,Role,Salt,Iterations,AuthHash,PublicKey,WrappedPrivateKey,WrappedContainerKey,CreatedAt)
            VALUES ($id,$un,$uk,$ro,$sa,$it,$ah,$pk,$wp,$wc,$ca)";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$un", u.Username.Trim());
        cmd.Parameters.AddWithValue("$uk", UsernameKey(u.Username));
        cmd.Parameters.AddWithValue("$ro", u.Role);
        cmd.Parameters.AddWithValue("$sa", u.Salt);
        cmd.Parameters.AddWithValue("$it", u.Iterations);
        cmd.Parameters.AddWithValue("$ah", u.AuthHash);
        cmd.Parameters.AddWithValue("$pk", u.PublicKey);
        cmd.Parameters.AddWithValue("$wp", u.WrappedPrivateKey);
        cmd.Parameters.AddWithValue("$wc", u.WrappedContainerKey);
        cmd.Parameters.AddWithValue("$ca", now);
        try
        {
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) // SQLITE_CONSTRAINT (UNIQUE on UsernameKey)
        {
            throw new DuplicateUsernameException(u.Username);
        }
        return FindById(id)!;
    }

    public UserRecord? FindByUsername(string username)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {UserColumns} FROM Users WHERE UsernameKey=$uk";
        cmd.Parameters.AddWithValue("$uk", UsernameKey(username));
        using var r = cmd.ExecuteReader();
        return r.Read() ? MapUser(r) : null;
    }

    public UserRecord? FindById(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {UserColumns} FROM Users WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        return r.Read() ? MapUser(r) : null;
    }

    public IReadOnlyList<UserRecord> ListUsers()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {UserColumns} FROM Users ORDER BY CreatedAt";
        var list = new List<UserRecord>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(MapUser(r));
        return list;
    }

    /// <summary>Increments the failure counter; from the 5th consecutive failure the account is locked for 15 minutes.</summary>
    public (int failures, DateTime? lockedUntil) RecordFailedLogin(string id)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();
        int failures;
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE Users SET FailedLogins = FailedLogins + 1 WHERE Id=$id RETURNING FailedLogins";
            cmd.Parameters.AddWithValue("$id", id);
            var res = cmd.ExecuteScalar();
            if (res == null) { tx.Commit(); return (0, null); }
            failures = Convert.ToInt32(res);
        }

        DateTime? lockedUntil = null;
        if (failures >= MaxFailedLogins)
        {
            lockedUntil = DateTime.UtcNow + LockoutDuration;
            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE Users SET LockedUntil=$lu WHERE Id=$id";
            cmd.Parameters.AddWithValue("$lu", ToMs(lockedUntil.Value));
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
        return (failures, lockedUntil);
    }

    public void ResetFailures(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Users SET FailedLogins=0, LockedUntil=NULL WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void SetDisabled(string id, bool disabled)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Users SET Disabled=$d WHERE Id=$id";
        cmd.Parameters.AddWithValue("$d", disabled ? 1 : 0);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void UpdateCredentials(string id, string salt, int iterations, string authHash,
                                  string wrappedPrivateKey, string wrappedContainerKey)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE Users SET Salt=$sa, Iterations=$it, AuthHash=$ah,
            WrappedPrivateKey=$wp, WrappedContainerKey=$wc, FailedLogins=0, LockedUntil=NULL WHERE Id=$id";
        cmd.Parameters.AddWithValue("$sa", salt);
        cmd.Parameters.AddWithValue("$it", iterations);
        cmd.Parameters.AddWithValue("$ah", authHash);
        cmd.Parameters.AddWithValue("$wp", wrappedPrivateKey);
        cmd.Parameters.AddWithValue("$wc", wrappedContainerKey);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    // ---- Invites -----------------------------------------------------------------------

    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>Creates an invite. The plaintext code is returned once; only its SHA-256 is stored.</summary>
    public (string id, string code) CreateInvite(string createdBy, TimeSpan ttl)
    {
        var id = Guid.NewGuid().ToString("N");
        var code = new string(RandomNumberGenerator.GetBytes(24).Select(b => Base32Alphabet[b % 32]).ToArray());
        var now = DateTime.UtcNow;
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO Invites (Id,CodeHash,CreatedBy,CreatedAt,ExpiresAt) VALUES ($id,$ch,$cb,$ca,$ea)";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$ch", HashInvite(code));
        cmd.Parameters.AddWithValue("$cb", createdBy);
        cmd.Parameters.AddWithValue("$ca", ToMs(now));
        cmd.Parameters.AddWithValue("$ea", ToMs(now + ttl));
        cmd.ExecuteNonQuery();
        return (id, code);
    }

    private static string HashInvite(string code) => Sha256Hex(code.Trim().ToUpperInvariant());

    /// <summary>Atomically consumes a valid (unredeemed, unrevoked, unexpired) invite.</summary>
    public bool RedeemInvite(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return false;
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE Invites SET RedeemedAt=$now
            WHERE CodeHash=$ch AND RedeemedAt IS NULL AND RevokedAt IS NULL AND ExpiresAt>$now";
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$ch", HashInvite(code));
        return cmd.ExecuteNonQuery() == 1;
    }

    /// <summary>All non-revoked invites, newest first.</summary>
    public IReadOnlyList<InviteRecord> ListInvites()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id,CreatedBy,CreatedAt,ExpiresAt,RedeemedAt FROM Invites WHERE RevokedAt IS NULL ORDER BY CreatedAt DESC";
        var list = new List<InviteRecord>();
        using var r = cmd.ExecuteReader();
        while (r.Read())
            list.Add(new InviteRecord(r.GetString(0), r.GetString(1), FromMs(r.GetInt64(2)), FromMs(r.GetInt64(3)),
                r.IsDBNull(4) ? null : FromMs(r.GetInt64(4))));
        return list;
    }

    /// <summary>Revokes an unredeemed invite. Returns false if it does not exist, was already redeemed, or was already revoked.</summary>
    public bool RevokeInvite(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Invites SET RevokedAt=$now WHERE Id=$id AND RedeemedAt IS NULL AND RevokedAt IS NULL";
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", id);
        return cmd.ExecuteNonQuery() == 1;
    }

    // ---- Sessions ----------------------------------------------------------------------

    public string CreateSession(string userId, string refreshHash)
    {
        var id = Guid.NewGuid().ToString("N");
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO Sessions (Id,UserId,RefreshHash,CreatedAt) VALUES ($id,$uid,$rh,$ca)";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$rh", refreshHash);
        cmd.Parameters.AddWithValue("$ca", Now());
        cmd.ExecuteNonQuery();
        return id;
    }

    /// <summary>True if the session exists and has not been revoked.</summary>
    public bool SessionExists(string sessionId)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT EXISTS(SELECT 1 FROM Sessions WHERE Id=$id AND RevokedAt IS NULL)";
        cmd.Parameters.AddWithValue("$id", sessionId);
        return Convert.ToInt64(cmd.ExecuteScalar()) == 1;
    }

    /// <summary>
    /// Swaps a session's refresh hash from <paramref name="oldHash"/> to <paramref name="newHash"/>.
    /// If <paramref name="oldHash"/> was already rotated (any earlier generation), the token was
    /// replayed: the owning session is revoked and Reused is reported.
    /// </summary>
    public RotateResult RotateSession(string oldHash, string newHash)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();

        using (var upd = conn.CreateCommand())
        {
            upd.Transaction = tx;
            upd.CommandText = @"UPDATE Sessions SET RefreshHash=$new, RotatedAt=$now
                WHERE RefreshHash=$old AND RevokedAt IS NULL RETURNING Id,UserId";
            upd.Parameters.AddWithValue("$new", newHash);
            upd.Parameters.AddWithValue("$old", oldHash);
            upd.Parameters.AddWithValue("$now", Now());
            string? sid = null, uid = null;
            using (var r = upd.ExecuteReader())
            {
                if (r.Read()) { sid = r.GetString(0); uid = r.GetString(1); }
            }
            if (sid != null)
            {
                using var ret = conn.CreateCommand();
                ret.Transaction = tx;
                ret.CommandText = "INSERT OR REPLACE INTO RetiredRefresh (Hash,SessionId,RetiredAt) VALUES ($h,$sid,$now)";
                ret.Parameters.AddWithValue("$h", oldHash);
                ret.Parameters.AddWithValue("$sid", sid);
                ret.Parameters.AddWithValue("$now", Now());
                ret.ExecuteNonQuery();
                tx.Commit();
                return new RotateResult(true, false, uid, sid);
            }
        }

        // Not a live token: was it a previously rotated one?
        using (var sel = conn.CreateCommand())
        {
            sel.Transaction = tx;
            sel.CommandText = @"SELECT s.Id,s.UserId FROM RetiredRefresh t JOIN Sessions s ON s.Id=t.SessionId WHERE t.Hash=$old";
            sel.Parameters.AddWithValue("$old", oldHash);
            string? sid = null, uid = null;
            using (var r = sel.ExecuteReader())
            {
                if (r.Read()) { sid = r.GetString(0); uid = r.GetString(1); }
            }
            if (sid != null)
            {
                using var rev = conn.CreateCommand();
                rev.Transaction = tx;
                rev.CommandText = "UPDATE Sessions SET RevokedAt=$now WHERE Id=$id AND RevokedAt IS NULL";
                rev.Parameters.AddWithValue("$now", Now());
                rev.Parameters.AddWithValue("$id", sid);
                rev.ExecuteNonQuery();
                tx.Commit();
                return new RotateResult(false, true, uid, sid);
            }
        }
        tx.Commit();
        return new RotateResult(false, false, null);
    }

    public void RevokeSession(string sessionId)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Sessions SET RevokedAt=$now WHERE Id=$id AND RevokedAt IS NULL";
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", sessionId);
        cmd.ExecuteNonQuery();
    }

    /// <summary>Revokes all of a user's sessions, optionally keeping one (e.g. the caller's).</summary>
    public void RevokeAllSessions(string userId, string? exceptSessionId = null)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Sessions SET RevokedAt=$now WHERE UserId=$uid AND RevokedAt IS NULL AND ($ex IS NULL OR Id<>$ex)";
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$ex", (object?)exceptSessionId ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    private static UserRecord MapUser(SqliteDataReader r) => new(
        r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt32(4), r.GetString(5),
        r.GetString(6), r.GetString(7), r.GetString(8), r.GetInt32(9) != 0, r.GetInt32(10),
        r.IsDBNull(11) ? null : FromMs(r.GetInt64(11)), FromMs(r.GetInt64(12)));
}
