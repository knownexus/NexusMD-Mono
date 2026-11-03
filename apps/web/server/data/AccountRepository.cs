using System.Data;
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
    /// <summary>Sliding idle lifetime of a session; each successful rotation pushes it out again.</summary>
    public static readonly TimeSpan SessionIdleLifetime = TimeSpan.FromDays(30);

    private const int SqliteConstraintUnique = 2067; // SQLITE_CONSTRAINT_UNIQUE

    private const string UserColumns =
        "Id,Username,Role,Salt,Iterations,AuthHash,PublicKey,WrappedPrivateKey,WrappedContainerKey,Disabled,FailedLogins,LockedUntil,CreatedAt";

    private readonly string _connectionString;

    public AccountRepository(IConfiguration config)
    {
        var dbPath = config["Accounts:DbPath"] ?? "accounts.db";
        if (!Path.IsPathRooted(dbPath))
            dbPath = Path.Combine(AppContext.BaseDirectory, dbPath);
        // Explicit busy timeout (seconds): writers wait for the lock instead of failing with SQLITE_BUSY.
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath, DefaultTimeout = 30 }.ToString();
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
        // WAL: readers never block the (serialised) writer, so concurrent requests queue on the busy
        // timeout instead of failing with "database is locked". The mode is persistent in the db file.
        cmd.CommandText = "PRAGMA journal_mode=WAL";
        cmd.ExecuteNonQuery();
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
                RevokedAt   INTEGER,
                ExpiresAt   INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS IX_Sessions_UserId ON Sessions (UserId);
            -- Hashes of refresh tokens that were already rotated; replaying one revokes its session.
            CREATE TABLE IF NOT EXISTS RetiredRefresh (
                Hash      TEXT    PRIMARY KEY,
                SessionId TEXT    NOT NULL,
                RetiredAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_RetiredRefresh_SessionId ON RetiredRefresh (SessionId);
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
                Size       INTEGER NOT NULL DEFAULT 0,
                Ciphertext TEXT    NOT NULL,
                Deleted    INTEGER NOT NULL DEFAULT 0,
                UpdatedAt  INTEGER NOT NULL,
                PRIMARY KEY (UserId, Id)
            );
            CREATE INDEX IF NOT EXISTS IX_Items_Cursor ON Items (UserId, Cursor);";
        cmd.ExecuteNonQuery();

        // Databases created before Sessions.ExpiresAt existed: add the column and give live sessions a fresh idle window.
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Sessions') WHERE name='ExpiresAt'";
        var hasExpires = Convert.ToInt64(cmd.ExecuteScalar()) == 1;
        if (!hasExpires)
        {
            cmd.CommandText = "ALTER TABLE Sessions ADD COLUMN ExpiresAt INTEGER NOT NULL DEFAULT 0";
            cmd.ExecuteNonQuery();
            cmd.CommandText = "UPDATE Sessions SET ExpiresAt=$exp";
            cmd.Parameters.AddWithValue("$exp", Now() + (long)SessionIdleLifetime.TotalMilliseconds);
            cmd.ExecuteNonQuery();
            cmd.Parameters.Clear();
        }
        cmd.CommandText = "CREATE INDEX IF NOT EXISTS IX_Sessions_ExpiresAt ON Sessions (ExpiresAt)";
        cmd.ExecuteNonQuery();

        MigrateItemSizes(conn);
    }

    /// <summary>
    /// Items.Size (the quota/page charge, see <see cref="ItemSize"/>) was added after the table first shipped.
    /// Runs in ONE BEGIN IMMEDIATE transaction so the ALTER and the backfill apply together or not at all and
    /// concurrent starters serialise (the column check is repeated inside the lock). The repair step also
    /// backfills any row still at Size=0 with a non-empty ciphertext, so a database left half-migrated by an
    /// earlier build heals on the next start. Both use the same formula as new writes: UTF-8 bytes of the
    /// ciphertext + UTF-8 bytes of the id + <see cref="RowOverheadBytes"/>.
    /// </summary>
    private static void MigrateItemSizes(SqliteConnection conn)
    {
        const string sizeSql = "LENGTH(CAST(Ciphertext AS BLOB)) + LENGTH(CAST(Id AS BLOB)) + 128";
        using var tx = conn.BeginTransaction(IsolationLevel.Serializable);
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Items') WHERE name='Size'";
        if (Convert.ToInt64(cmd.ExecuteScalar()) == 0)
        {
            cmd.CommandText = "ALTER TABLE Items ADD COLUMN Size INTEGER NOT NULL DEFAULT 0";
            cmd.ExecuteNonQuery();
        }
        // Partial index: finding "no unsized rows" at startup costs nothing, however large the table is.
        cmd.CommandText = "CREATE INDEX IF NOT EXISTS IX_Items_Unsized ON Items (UserId) WHERE Size=0";
        cmd.ExecuteNonQuery();
        cmd.CommandText = $"UPDATE Items SET Size={sizeSql} WHERE Size=0 AND Ciphertext<>''";
        cmd.ExecuteNonQuery();
        // Covering index so a user's total stored bytes (quota check) never reads the ciphertext pages.
        cmd.CommandText = "CREATE INDEX IF NOT EXISTS IX_Items_Usage ON Items (UserId, Size)";
        cmd.ExecuteNonQuery();
        tx.Commit();
    }

    /// <summary>Fixed per-row charge on top of the ciphertext and id bytes, so many tiny items still consume quota.</summary>
    public const int RowOverheadBytes = 128;

    /// <summary>What an item row is charged against the user's quota and the changes-page byte budget.</summary>
    public static long ItemSize(string id, string ciphertext) =>
        Encoding.UTF8.GetByteCount(ciphertext) + Encoding.UTF8.GetByteCount(id) + RowOverheadBytes;

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static long ToMs(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
    private static DateTime FromMs(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
    private static string Sha256Hex(string s) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    // NFC first so composed/decomposed forms of the same name collide; then trim and lower-case.
    private static string UsernameKey(string username) =>
        username.Normalize(NormalizationForm.FormC).Trim().ToLowerInvariant();

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
        using var conn = OpenConnection();
        var id = InsertUser(conn, null, u)!;
        return FindById(id)!;
    }

    /// <summary>
    /// Consumes the invite and creates the user in one transaction, so a duplicate username (or any
    /// other failure) does not burn the invite.
    /// </summary>
    /// <exception cref="InvalidInviteException">Unknown, used, expired or revoked invite.</exception>
    /// <exception cref="DuplicateUsernameException">Username already taken.</exception>
    public UserRecord CreateUserFromInvite(string inviteCode, NewUser user)
    {
        if (string.IsNullOrWhiteSpace(inviteCode)) throw new InvalidInviteException();
        string id;
        using (var conn = OpenConnection())
        using (var tx = conn.BeginTransaction())
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = @"UPDATE Invites SET RedeemedAt=$now
                    WHERE CodeHash=$ch AND RedeemedAt IS NULL AND RevokedAt IS NULL AND ExpiresAt>$now";
                cmd.Parameters.AddWithValue("$now", Now());
                cmd.Parameters.AddWithValue("$ch", HashInvite(inviteCode));
                if (cmd.ExecuteNonQuery() != 1) throw new InvalidInviteException();
            }
            id = InsertUser(conn, tx, user)!; // throws -> transaction disposed uncommitted -> invite not consumed
            tx.Commit();
        }
        return FindById(id)!;
    }

    /// <summary>
    /// Creates the very first account only if the Users table is empty. The check and the insert are one
    /// statement, so racing callers (threads or processes) cannot both succeed. Returns null if any user exists.
    /// </summary>
    public UserRecord? CreateFirstUser(NewUser u)
    {
        using var conn = OpenConnection();
        var id = InsertUser(conn, null, u, onlyIfEmpty: true);
        return id is null ? null : FindById(id);
    }

    private static string? InsertUser(SqliteConnection conn, SqliteTransaction? tx, NewUser u, bool onlyIfEmpty = false)
    {
        var id = Guid.NewGuid().ToString("N");
        var now = Now();
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        const string cols = "Id,Username,UsernameKey,Role,Salt,Iterations,AuthHash,PublicKey,WrappedPrivateKey,WrappedContainerKey,CreatedAt";
        const string vals = "$id,$un,$uk,$ro,$sa,$it,$ah,$pk,$wp,$wc,$ca";
        cmd.CommandText = onlyIfEmpty
            ? $"INSERT INTO Users ({cols}) SELECT {vals} WHERE NOT EXISTS (SELECT 1 FROM Users)"
            : $"INSERT INTO Users ({cols}) VALUES ({vals})";
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
            return cmd.ExecuteNonQuery() == 1 ? id : null;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == SqliteConstraintUnique) // UNIQUE on UsernameKey only
        {
            throw new DuplicateUsernameException(u.Username);
        }
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

    /// <summary>
    /// Reserves a login (or password-change) attempt BEFORE the secret is verified, in one conditional
    /// UPDATE...RETURNING, so concurrent guesses cannot all slip past a lock check. Allowed only when the
    /// account is not currently locked. Each allowed reservation counts as a failure up front: the count
    /// restarts at 1 if an earlier lock has expired, otherwise increments, and reaching
    /// <see cref="MaxFailedLogins"/> sets the lock for <see cref="LockoutDuration"/>. A successful attempt
    /// must call <see cref="ResetFailuresIfCount"/>. When not allowed nothing changes (no increment, no
    /// extension) and the current count and lock expiry are returned.
    /// </summary>
    public (bool allowed, int failures, DateTime? lockedUntil) TryReserveLoginAttempt(string id)
    {
        const string newCount = "(CASE WHEN LockedUntil IS NOT NULL THEN 1 ELSE FailedLogins + 1 END)";
        using var conn = OpenConnection();
        var now = DateTime.UtcNow;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"UPDATE Users SET
                    FailedLogins = " + newCount + @",
                    LockedUntil  = CASE WHEN " + newCount + @" >= $max THEN $lu ELSE NULL END
                WHERE Id=$id AND (LockedUntil IS NULL OR LockedUntil <= $now)
                RETURNING FailedLogins, LockedUntil";
            cmd.Parameters.AddWithValue("$now", ToMs(now));
            cmd.Parameters.AddWithValue("$max", MaxFailedLogins);
            cmd.Parameters.AddWithValue("$lu", ToMs(now + LockoutDuration));
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            if (r.Read()) return (true, r.GetInt32(0), r.IsDBNull(1) ? null : FromMs(r.GetInt64(1)));
        }
        // Not allowed: the user is locked (or does not exist).
        using var sel = conn.CreateCommand();
        sel.CommandText = "SELECT FailedLogins, LockedUntil FROM Users WHERE Id=$id";
        sel.Parameters.AddWithValue("$id", id);
        using var s = sel.ExecuteReader();
        return s.Read() ? (false, s.GetInt32(0), s.IsDBNull(1) ? null : FromMs(s.GetInt64(1))) : (false, 0, null);
    }

    public void ResetFailures(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Users SET FailedLogins=0, LockedUntil=NULL WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Clears the failure counter and lock only if the stored count is still the one produced by this
    /// caller's reservation. If concurrent attempts have since advanced the count (possibly setting a lock),
    /// nothing is cleared.
    /// </summary>
    public void ResetFailuresIfCount(string id, int expectedCount)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Users SET FailedLogins=0, LockedUntil=NULL WHERE Id=$id AND FailedLogins=$c";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$c", expectedCount);
        cmd.ExecuteNonQuery();
    }

    /// <summary>Enables/disables a user. Disabling also revokes all of the user's sessions in the same transaction.</summary>
    public void SetDisabled(string id, bool disabled)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE Users SET Disabled=$d WHERE Id=$id";
            cmd.Parameters.AddWithValue("$d", disabled ? 1 : 0);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
        if (disabled) RevokeUserSessions(conn, tx, id, null);
        tx.Commit();
    }

    /// <summary>
    /// Replaces a user's credentials, revokes ALL of their sessions and creates one new session (for the
    /// new credentials) in a single transaction, so no session for the old credentials can survive.
    /// Resets the failure counter. Returns the new session id, or null (nothing changed) if the user does not exist or,
    /// when <paramref name="expectedAuthHash"/> is given, no longer has that auth hash.
    /// </summary>
    public string? ChangeCredentials(string id, string salt, int iterations, string authHash,
                                    string wrappedPrivateKey, string wrappedContainerKey, string newRefreshHash,
                                    string? expectedAuthHash = null)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = @"UPDATE Users SET Salt=$sa, Iterations=$it, AuthHash=$ah,
                WrappedPrivateKey=$wp, WrappedContainerKey=$wc, FailedLogins=0, LockedUntil=NULL
                WHERE Id=$id AND ($ea IS NULL OR AuthHash=$ea)";
            cmd.Parameters.AddWithValue("$ea", (object?)expectedAuthHash ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$sa", salt);
            cmd.Parameters.AddWithValue("$it", iterations);
            cmd.Parameters.AddWithValue("$ah", authHash);
            cmd.Parameters.AddWithValue("$wp", wrappedPrivateKey);
            cmd.Parameters.AddWithValue("$wc", wrappedContainerKey);
            cmd.Parameters.AddWithValue("$id", id);
            if (cmd.ExecuteNonQuery() != 1) return null; // transaction disposed uncommitted
        }
        RevokeUserSessions(conn, tx, id, null);
        var sid = Guid.NewGuid().ToString("N");
        using (var ins = conn.CreateCommand())
        {
            ins.Transaction = tx;
            ins.CommandText = "INSERT INTO Sessions (Id,UserId,RefreshHash,CreatedAt,ExpiresAt) VALUES ($id,$uid,$rh,$ca,$ex)";
            ins.Parameters.AddWithValue("$id", sid);
            ins.Parameters.AddWithValue("$uid", id);
            ins.Parameters.AddWithValue("$rh", newRefreshHash);
            ins.Parameters.AddWithValue("$ca", Now());
            ins.Parameters.AddWithValue("$ex", Now() + (long)SessionIdleLifetime.TotalMilliseconds);
            ins.ExecuteNonQuery();
        }
        tx.Commit();
        return sid;
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
        cmd.CommandText = "INSERT INTO Sessions (Id,UserId,RefreshHash,CreatedAt,ExpiresAt) VALUES ($id,$uid,$rh,$ca,$ex)";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$rh", refreshHash);
        cmd.Parameters.AddWithValue("$ca", Now());
        cmd.Parameters.AddWithValue("$ex", Now() + (long)SessionIdleLifetime.TotalMilliseconds);
        cmd.ExecuteNonQuery();
        return id;
    }

    /// <summary>
    /// Creates a session only if the user still exists, is not disabled and still has
    /// <paramref name="expectedAuthHash"/> (the hash the caller just verified a key against), in one
    /// statement. Returns the session id, or null if the credentials changed (or the user was disabled)
    /// in the meantime. Virtual so tests can interleave another request at this seam.
    /// </summary>
    public virtual string? CreateSessionIfCredentialsCurrent(string userId, string refreshHash, string expectedAuthHash)
    {
        var id = Guid.NewGuid().ToString("N");
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO Sessions (Id,UserId,RefreshHash,CreatedAt,ExpiresAt)
            SELECT $id,$uid,$rh,$ca,$ex FROM Users WHERE Id=$uid AND AuthHash=$ah AND Disabled=0";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$rh", refreshHash);
        cmd.Parameters.AddWithValue("$ca", Now());
        cmd.Parameters.AddWithValue("$ex", Now() + (long)SessionIdleLifetime.TotalMilliseconds);
        cmd.Parameters.AddWithValue("$ah", expectedAuthHash);
        return cmd.ExecuteNonQuery() == 1 ? id : null;
    }

    /// <summary>True if the session exists, is not revoked or idle-expired, and its user is not disabled.</summary>
    public bool SessionExists(string sessionId)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT EXISTS(SELECT 1 FROM Sessions s JOIN Users u ON u.Id=s.UserId
            WHERE s.Id=$id AND s.RevokedAt IS NULL AND s.ExpiresAt>$now AND u.Disabled=0)";
        cmd.Parameters.AddWithValue("$id", sessionId);
        cmd.Parameters.AddWithValue("$now", Now());
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
            // Sliding idle expiry: a successful rotation pushes ExpiresAt out by SessionIdleLifetime.
            upd.CommandText = @"UPDATE Sessions SET RefreshHash=$new, RotatedAt=$now, ExpiresAt=$exp
                WHERE RefreshHash=$old AND RevokedAt IS NULL AND ExpiresAt>$now
                  AND UserId IN (SELECT Id FROM Users WHERE Disabled=0)
                RETURNING Id,UserId";
            upd.Parameters.AddWithValue("$new", newHash);
            upd.Parameters.AddWithValue("$old", oldHash);
            upd.Parameters.AddWithValue("$now", Now());
            upd.Parameters.AddWithValue("$exp", Now() + (long)SessionIdleLifetime.TotalMilliseconds);
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
                PurgeStale(conn, tx);
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
                RevokeSessionById(conn, tx, sid);
                tx.Commit();
                return new RotateResult(false, true, uid, sid);
            }
        }
        tx.Commit();
        return new RotateResult(false, false, null);
    }

    /// <summary>
    /// Revokes the live session that owns <paramref name="refreshHash"/>, but only if it belongs to
    /// <paramref name="userId"/>. Returns false when no such live session exists.
    /// </summary>
    public bool RevokeSessionByRefreshHash(string refreshHash, string userId)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();
        string? sid = null;
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "SELECT Id FROM Sessions WHERE RefreshHash=$rh AND UserId=$uid AND RevokedAt IS NULL";
            cmd.Parameters.AddWithValue("$rh", refreshHash);
            cmd.Parameters.AddWithValue("$uid", userId);
            sid = cmd.ExecuteScalar() as string;
        }
        if (sid != null) RevokeSessionById(conn, tx, sid);
        tx.Commit();
        return sid != null;
    }

    public void RevokeSession(string sessionId)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();
        RevokeSessionById(conn, tx, sessionId);
        tx.Commit();
    }

    /// <summary>Revokes all of a user's sessions, optionally keeping one (e.g. the caller's).</summary>
    public void RevokeAllSessions(string userId, string? exceptSessionId = null)
    {
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();
        RevokeUserSessions(conn, tx, userId, exceptSessionId);
        tx.Commit();
    }

    // A revoked session can never rotate again, so its retired-token rows are dead weight: drop them.
    private static void RevokeSessionById(SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE Sessions SET RevokedAt=$now WHERE Id=$id AND RevokedAt IS NULL";
            cmd.Parameters.AddWithValue("$now", Now());
            cmd.Parameters.AddWithValue("$id", sessionId);
            cmd.ExecuteNonQuery();
        }
        using (var del = conn.CreateCommand())
        {
            del.Transaction = tx;
            del.CommandText = "DELETE FROM RetiredRefresh WHERE SessionId=$id";
            del.Parameters.AddWithValue("$id", sessionId);
            del.ExecuteNonQuery();
        }
    }

    private static void RevokeUserSessions(SqliteConnection conn, SqliteTransaction tx, string userId, string? exceptSessionId)
    {
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE Sessions SET RevokedAt=$now WHERE UserId=$uid AND RevokedAt IS NULL AND ($ex IS NULL OR Id<>$ex)";
            cmd.Parameters.AddWithValue("$now", Now());
            cmd.Parameters.AddWithValue("$uid", userId);
            cmd.Parameters.AddWithValue("$ex", (object?)exceptSessionId ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
        using (var del = conn.CreateCommand())
        {
            del.Transaction = tx;
            del.CommandText = @"DELETE FROM RetiredRefresh
                WHERE SessionId IN (SELECT Id FROM Sessions WHERE UserId=$uid AND RevokedAt IS NOT NULL)";
            del.Parameters.AddWithValue("$uid", userId);
            del.ExecuteNonQuery();
        }
    }

    // Opportunistic cleanup run on successful rotations: idle-expired sessions, then retired rows whose
    // session is gone or revoked.
    private static void PurgeStale(SqliteConnection conn, SqliteTransaction tx)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = @"DELETE FROM Sessions WHERE ExpiresAt<=$now;
            DELETE FROM RetiredRefresh WHERE SessionId NOT IN (SELECT Id FROM Sessions WHERE RevokedAt IS NULL);";
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.ExecuteNonQuery();
    }

    // ---- Devices -----------------------------------------------------------------------

    public const int MaxDevicesPerUser = 50;

    public IReadOnlyList<DeviceRecord> ListDevices(string userId)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id,Name,Platform,UpdatedAt FROM Devices WHERE UserId=$uid ORDER BY CreatedAt, Id";
        cmd.Parameters.AddWithValue("$uid", userId);
        var list = new List<DeviceRecord>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(new DeviceRecord(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt64(3)));
        return list;
    }

    /// <summary>
    /// Registers a device unless the user already has <see cref="MaxDevicesPerUser"/>. The count check and the
    /// insert are one statement, so racing creates cannot exceed the cap. Null when the cap is reached.
    /// </summary>
    public DeviceRecord? CreateDevice(string userId, string name, string platform)
    {
        var id = Guid.NewGuid().ToString("N");
        var now = Now();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO Devices (Id,UserId,Name,Platform,Revision,CreatedAt,UpdatedAt)
            SELECT $id,$uid,$name,$pl,0,$now,$now WHERE (SELECT COUNT(*) FROM Devices WHERE UserId=$uid) < $max";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$name", name);
        cmd.Parameters.AddWithValue("$pl", platform);
        cmd.Parameters.AddWithValue("$now", now);
        cmd.Parameters.AddWithValue("$max", MaxDevicesPerUser);
        return cmd.ExecuteNonQuery() == 1 ? new DeviceRecord(id, name, platform, now) : null;
    }

    /// <summary>Renames one of the user's devices. Null if it does not exist or belongs to someone else.</summary>
    public DeviceRecord? RenameDevice(string userId, string id, string name)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE Devices SET Name=$name, UpdatedAt=$now WHERE Id=$id AND UserId=$uid
            RETURNING Id,Name,Platform,UpdatedAt";
        cmd.Parameters.AddWithValue("$name", name);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        using var r = cmd.ExecuteReader();
        return r.Read() ? new DeviceRecord(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt64(3)) : null;
    }

    public bool DeleteDevice(string userId, string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM Devices WHERE Id=$id AND UserId=$uid";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        return cmd.ExecuteNonQuery() == 1;
    }

    /// <summary>The device's prefs blob and revision (0 and empty when never written). Null if not the user's device.</summary>
    public (long revision, string ciphertext)? GetDevicePrefs(string userId, string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Revision, Prefs FROM Devices WHERE Id=$id AND UserId=$uid";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$uid", userId);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return (r.GetInt64(0), r.IsDBNull(1) ? "" : r.GetString(1));
    }

    /// <summary>
    /// Compare-and-set of a device's prefs blob: one conditional UPDATE, so of any number of concurrent
    /// writers holding the same <paramref name="expectedRevision"/> exactly one wins.
    /// </summary>
    public WriteResult PutDevicePrefs(string userId, string id, long expectedRevision, string ciphertext)
    {
        using var conn = OpenConnection();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"UPDATE Devices SET Prefs=$p, Revision=Revision+1, UpdatedAt=$now
                WHERE Id=$id AND UserId=$uid AND Revision=$exp RETURNING Revision";
            cmd.Parameters.AddWithValue("$p", ciphertext);
            cmd.Parameters.AddWithValue("$now", Now());
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$uid", userId);
            cmd.Parameters.AddWithValue("$exp", expectedRevision);
            using var r = cmd.ExecuteReader();
            if (r.Read()) return new WriteResult(WriteStatus.Ok, r.GetInt64(0));
        }
        using var sel = conn.CreateCommand();
        sel.CommandText = "SELECT EXISTS(SELECT 1 FROM Devices WHERE Id=$id AND UserId=$uid)";
        sel.Parameters.AddWithValue("$id", id);
        sel.Parameters.AddWithValue("$uid", userId);
        return new WriteResult(Convert.ToInt64(sel.ExecuteScalar()) == 1 ? WriteStatus.Conflict : WriteStatus.NotFound);
    }

    // ---- Items -------------------------------------------------------------------------

    /// <summary>Writes one item (see <see cref="WriteItems"/>).</summary>
    public WriteResult WriteItem(string userId, ItemWrite write, long maxUserBytes = long.MaxValue) =>
        WriteItems(userId, new[] { write }, maxUserBytes)[0];

    /// <summary>
    /// Applies independent compare-and-set writes in one transaction (BEGIN IMMEDIATE, so writers are
    /// serialised and the revision check, quota check, cursor assignment and upsert cannot interleave).
    /// Entry i of the result is Ok (with the new revision and the per-user cursor, MAX(Cursor)+1), Conflict
    /// (stale revision) or Quota (the write would push the user's total stored ciphertext bytes, live and
    /// tombstoned rows alike, over <paramref name="maxUserBytes"/>; replacing a row counts only the size
    /// difference, and a write that does not grow the total is never refused). A rejected write neither
    /// writes nor consumes a cursor and does not affect the other writes.
    /// </summary>
    public IReadOnlyList<WriteResult> WriteItems(string userId, IReadOnlyList<ItemWrite> writes, long maxUserBytes = long.MaxValue)
    {
        var results = new List<WriteResult>(writes.Count);
        if (writes.Count == 0) return results;
        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction(IsolationLevel.Serializable); // BEGIN IMMEDIATE
        using var sel = conn.CreateCommand();
        sel.Transaction = tx;
        sel.CommandText = "SELECT Revision, Size FROM Items WHERE UserId=$uid AND Id=$id";
        sel.Parameters.AddWithValue("$uid", userId);
        var selId = sel.Parameters.Add("$id", SqliteType.Text);
        using var cur = conn.CreateCommand();
        cur.Transaction = tx;
        cur.CommandText = "SELECT COALESCE(MAX(Cursor),0)+1 FROM Items WHERE UserId=$uid";
        cur.Parameters.AddWithValue("$uid", userId);
        using var usage = conn.CreateCommand();
        usage.Transaction = tx;
        usage.CommandText = "SELECT COALESCE(SUM(Size),0) FROM Items WHERE UserId=$uid";
        usage.Parameters.AddWithValue("$uid", userId);
        var total = Convert.ToInt64(usage.ExecuteScalar());
        using var up = conn.CreateCommand();
        up.Transaction = tx;
        up.CommandText = @"INSERT INTO Items (UserId,Id,Revision,Cursor,Size,Ciphertext,Deleted,UpdatedAt)
            VALUES ($uid,$id,$rev,$cur,$size,$ct,$del,$now)
            ON CONFLICT (UserId,Id) DO UPDATE SET Revision=$rev, Cursor=$cur, Size=$size, Ciphertext=$ct, Deleted=$del, UpdatedAt=$now";
        up.Parameters.AddWithValue("$uid", userId);
        var upId = up.Parameters.Add("$id", SqliteType.Text);
        var upRev = up.Parameters.Add("$rev", SqliteType.Integer);
        var upCur = up.Parameters.Add("$cur", SqliteType.Integer);
        var upSize = up.Parameters.Add("$size", SqliteType.Integer);
        var upCt = up.Parameters.Add("$ct", SqliteType.Text);
        var upDel = up.Parameters.Add("$del", SqliteType.Integer);
        var upNow = up.Parameters.Add("$now", SqliteType.Integer);

        foreach (var w in writes)
        {
            selId.Value = w.Id;
            long current = 0, oldSize = 0;
            using (var r = sel.ExecuteReader())
            {
                if (r.Read()) { current = r.GetInt64(0); oldSize = r.GetInt64(1); }
            }
            if (current != w.IfMatch) { results.Add(new WriteResult(WriteStatus.Conflict)); continue; }
            var size = ItemSize(w.Id, w.Ciphertext);
            var delta = size - oldSize;
            if (delta > 0 && total + delta > maxUserBytes) { results.Add(new WriteResult(WriteStatus.Quota)); continue; }
            var cursor = Convert.ToInt64(cur.ExecuteScalar());
            var revision = current + 1;
            upId.Value = w.Id; upRev.Value = revision; upCur.Value = cursor; upSize.Value = size;
            upCt.Value = w.Ciphertext; upDel.Value = w.Deleted ? 1 : 0; upNow.Value = Now();
            up.ExecuteNonQuery();
            total += delta;
            results.Add(new WriteResult(WriteStatus.Ok, revision, cursor));
        }
        tx.Commit();
        return results;
    }

    /// <summary>Test seam: runs inside the changes read transaction, after the metadata step and before the ciphertext step.</summary>
    public virtual void AfterChangesMetadataRead() { }

    /// <summary>
    /// One page of the user's items with Cursor greater than <paramref name="since"/>, oldest first: at most
    /// <paramref name="limit"/> rows and (after the first, which is always included) at most
    /// <paramref name="maxPageBytes"/> of charged size in total (<see cref="ItemSize"/>). <c>hasMore</c> is true
    /// when rows exist beyond the page, whichever limit cut it.
    /// Two steps inside one read transaction (a consistent snapshot): first the metadata of up to limit+1 rows
    /// WITHOUT the ciphertext column, from which the page is decided using the stored Size; then the ciphertext
    /// of the accepted rows only, by cursor range. A rejected row's ciphertext is never loaded, so at most the
    /// budget plus one item is ever materialised. Cursors are unique per user, so the range is exact.
    /// </summary>
    public (IReadOnlyList<ItemRecord> items, bool hasMore) GetItemChanges(string userId, long since, int limit, long maxPageBytes)
    {
        using var conn = OpenConnection();
        // Plain BEGIN (deferred): no lock is taken until the first read, which pins one WAL snapshot for both steps.
        // Microsoft.Data.Sqlite otherwise begins EVERY transaction as BEGIN IMMEDIATE (whatever the isolation level),
        // which would make a slow reader hold the write lock and stall all writers.
        using var tx = conn.BeginTransaction(deferred: true);

        var meta = new List<(string id, long revision, long cursor, bool deleted, long updatedAt)>();
        var hasMore = false;
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = @"SELECT Id,Revision,Cursor,Size,Deleted,UpdatedAt FROM Items
                WHERE UserId=$uid AND Cursor>$since ORDER BY Cursor LIMIT $limit";
            cmd.Parameters.AddWithValue("$uid", userId);
            cmd.Parameters.AddWithValue("$since", since);
            cmd.Parameters.AddWithValue("$limit", (long)limit + 1); // one extra row only to learn whether more exist
            long bytes = 0;
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var size = r.GetInt64(3);
                if (meta.Count >= limit || (meta.Count > 0 && bytes + size > maxPageBytes)) { hasMore = true; break; }
                bytes += size;
                meta.Add((r.GetString(0), r.GetInt64(1), r.GetInt64(2), r.GetInt32(4) != 0, r.GetInt64(5)));
            }
        }
        AfterChangesMetadataRead();
        if (meta.Count == 0) return (Array.Empty<ItemRecord>(), hasMore);

        var list = new List<ItemRecord>(meta.Count);
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = @"SELECT Cursor,Ciphertext FROM Items
                WHERE UserId=$uid AND Cursor>$since AND Cursor<=$last ORDER BY Cursor";
            cmd.Parameters.AddWithValue("$uid", userId);
            cmd.Parameters.AddWithValue("$since", since);
            cmd.Parameters.AddWithValue("$last", meta[^1].cursor);
            using var r = cmd.ExecuteReader();
            foreach (var m in meta)
            {
                if (!r.Read() || r.GetInt64(0) != m.cursor)
                    throw new InvalidOperationException("Item changes snapshot is inconsistent.");
                list.Add(new ItemRecord(m.id, m.revision, m.cursor, r.GetString(1), m.deleted, m.updatedAt));
            }
        }
        return (list, hasMore);
    }

    private static UserRecord MapUser(SqliteDataReader r) => new(
        r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt32(4), r.GetString(5),
        r.GetString(6), r.GetString(7), r.GetString(8), r.GetInt32(9) != 0, r.GetInt32(10),
        r.IsDBNull(11) ? null : FromMs(r.GetInt64(11)), FromMs(r.GetInt64(12)));
}
