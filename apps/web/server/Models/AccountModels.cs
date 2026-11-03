namespace NexusMDWeb.Api.Models;

/// <summary>
/// Input for creating an account. All key material is opaque, client-produced base64:
/// the server never receives a vault key, container key or plaintext.
/// <paramref name="AuthHash"/> is the server-side PBKDF2 hash of the client's auth key
/// (see PasswordHasher), not the auth key itself.
/// </summary>
public record NewUser(
    string Username,
    string Role,                 // "admin" | "user"
    string Salt,                 // client KDF salt (base64)
    int    Iterations,           // client KDF iterations
    string AuthHash,             // PasswordHasher.Hash(authKey)
    string PublicKey,            // ECDH public key (spki, base64)
    string WrappedPrivateKey,    // private key wrapped by the client's vault key
    string WrappedContainerKey); // personal container key wrapped by the vault key

public record UserRecord(
    string    Id,
    string    Username,
    string    Role,
    string    Salt,
    int       Iterations,
    string    AuthHash,
    string    PublicKey,
    string    WrappedPrivateKey,
    string    WrappedContainerKey,
    bool      Disabled,
    int       FailedLogins,
    DateTime? LockedUntil,       // UTC
    DateTime  CreatedAt);        // UTC

public record InviteRecord(
    string    Id,
    string    CreatedBy,
    DateTime  CreatedAt,
    DateTime  ExpiresAt,
    DateTime? RedeemedAt);

/// <summary>Outcome of rotating a refresh token. <c>Reused</c> means a retired token was replayed and the session was revoked.</summary>
public record RotateResult(bool Ok, bool Reused, string? UserId, string? SessionId = null);

public class DuplicateUsernameException : Exception
{
    public DuplicateUsernameException(string username)
        : base($"Username '{username}' is already taken.") { }
}

/// <summary>The invite code is unknown, already redeemed, revoked or expired.</summary>
public class InvalidInviteException : Exception
{
    public InvalidInviteException() : base("The invite is invalid, expired or already used.") { }
}

// ---- devices and items -------------------------------------------------------------------

/// <summary>A registered device. Timestamps are Unix milliseconds (UTC).</summary>
public record DeviceRecord(string Id, string Name, string Platform, long UpdatedAt);

public enum WriteStatus { Ok, Conflict, NotFound, Quota }

/// <summary>Result of a conditional write: the new revision (and item cursor) on <see cref="WriteStatus.Ok"/>.</summary>
public record WriteResult(WriteStatus Status, long Revision = 0, long Cursor = 0);

/// <summary>One row of the per-user item feed. <c>Ciphertext</c> is an opaque client-encrypted blob (kept for tombstones too).</summary>
public record ItemRecord(string Id, long Revision, long Cursor, string Ciphertext, bool Deleted, long UpdatedAt);

/// <summary>One write in a batch. <c>IfMatch</c> is the expected current revision (0 = create).</summary>
public record ItemWrite(string Id, long IfMatch, string Ciphertext, bool Deleted);
