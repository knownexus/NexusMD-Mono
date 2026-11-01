using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Models;
using NexusMDWeb.Api.Services.Auth;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Account lifecycle: first-admin setup, invite redemption, login, token refresh, logout and
/// password change. The client derives an auth key and a vault key from the password; the server only
/// ever sees the auth key (which it hashes again) and opaque wrapped key blobs. It never receives a
/// vault key, container key or plaintext. Passwords, auth keys, refresh tokens and wrapped keys are
/// never logged.
/// </summary>
[ApiController]
[Route("api/account")]
[RequestSizeLimit(MaxBodyBytes)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class AccountController(
    AccountRepository accounts,
    TokenService tokens,
    IConfiguration config,
    IHostEnvironment env,
    ILogger<AccountController> log) : ControllerBase
{
    private const int MaxBodyBytes = 16 * 1024;
    private const int MaxFieldChars = 8192;      // each base64 field (wrapped keys are a few hundred bytes)
    private const int MaxTokenChars = 512;       // refresh tokens / setup token / invite code
    private const int MinUsernameChars = 3;
    private const int MaxUsernameChars = 64;
    private const int MinIterations = 1_000;
    private const int MaxIterations = 10_000_000;
    private const int SaltBytes = 16;
    private const int AuthKeyBytes = 32;
    private const int FakeIterations = 600_000;

    // Setup is "check no users, then insert": serialise it so two concurrent calls cannot both succeed.
    private static readonly object SetupLock = new();

    // Verified against for unknown usernames so the response time does not reveal whether a user exists.
    private static readonly Lazy<string> DummyHash = new(() => PasswordHasher.Hash(new byte[AuthKeyBytes]));

    // ---- request shapes ----------------------------------------------------------------

    public record CreateAccountRequest(
        string? Username, string? Salt, int Iterations, string? AuthKey,
        string? PublicKey, string? WrappedPrivateKey, string? WrappedContainerKey,
        string? SetupToken, string? InviteCode);

    public record LoginRequest(string? Username, string? AuthKey);
    public record RefreshRequest(string? RefreshToken);
    public record ChangePasswordRequest(
        string? CurrentAuthKey, string? Salt, int Iterations, string? AuthKey,
        string? WrappedPrivateKey, string? WrappedContainerKey);

    // ---- status / params ---------------------------------------------------------------

    // GET /api/account/status -> { needsSetup }
    [HttpGet("status")]
    public IActionResult Status() => Ok(new { needsSetup = !accounts.AnyUser() });

    // GET /api/account/params?username= -> { salt, iterations }. Unknown users get a stable fake salt.
    [HttpGet("params")]
    public IActionResult Params([FromQuery] string? username)
    {
        if (!TryNormalizeUsername(username, out var name)) return Err(400, "invalid username");
        var user = accounts.FindByUsername(name);
        if (user != null) return Ok(new { salt = user.Salt, iterations = user.Iterations });
        return Ok(new { salt = FakeSalt(name), iterations = FakeIterations });
    }

    // ---- setup / redeem ----------------------------------------------------------------

    // POST /api/account/setup -> 201 session. Creates the first (admin) account; needs Accounts:SetupToken.
    [HttpPost("setup")]
    public IActionResult Setup([FromBody] CreateAccountRequest? req)
    {
        if (req is null) return Err(400, "request body is required");

        var configured = config["Accounts:SetupToken"];
        if (string.IsNullOrEmpty(configured) || !ConstantTimeEquals(req.SetupToken ?? "", configured))
            return Err(403, "setup is not available");

        if (!TryParseCreate(req, "admin", out var newUser, out var error)) return Err(400, error);

        UserRecord created;
        lock (SetupLock)
        {
            if (accounts.AnyUser()) return Err(409, "setup has already been completed");
            try { created = accounts.CreateUser(newUser); }
            catch (DuplicateUsernameException) { return Err(409, "setup has already been completed"); }
        }

        log.LogInformation("Initial admin account {UserId} created", created.Id);
        return StatusCode(StatusCodes.Status201Created, BuildSession(created));
    }

    // POST /api/account/redeem -> 201 session. Invite-only registration.
    [HttpPost("redeem")]
    public IActionResult Redeem([FromBody] CreateAccountRequest? req)
    {
        if (req is null) return Err(400, "request body is required");
        if (!IsBoundedText(req.InviteCode, MaxTokenChars)) return Err(400, "invalid invite");
        if (!TryParseCreate(req, "user", out var newUser, out var error)) return Err(400, error);

        UserRecord created;
        try { created = accounts.CreateUserFromInvite(req.InviteCode!, newUser); }
        catch (InvalidInviteException) { return Err(400, "the invite is invalid, expired or already used"); }
        catch (DuplicateUsernameException) { return Err(409, "that username is already taken"); }

        log.LogInformation("Account {UserId} created from an invite", created.Id);
        return StatusCode(StatusCodes.Status201Created, BuildSession(created));
    }

    // ---- login / refresh / logout ------------------------------------------------------

    // POST /api/account/login -> 200 session | 401 | 403 disabled | 423 locked
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest? req)
    {
        if (req is null) return Err(400, "request body is required");
        if (!TryNormalizeUsername(req.Username, out var name)) return Err(400, "invalid username");
        if (!TryDecode(req.AuthKey, out var authKey) || authKey.Length != AuthKeyBytes) return Err(400, "invalid authKey");

        var user = accounts.FindByUsername(name);
        if (user is null)
        {
            PasswordHasher.Verify(authKey, DummyHash.Value); // equalise timing with the known-user path
            return InvalidCredentials();
        }

        // Check the lock first: while locked we neither verify the key nor record a failure.
        if (IsLocked(user)) return Locked(user.LockedUntil!.Value);

        if (!PasswordHasher.Verify(authKey, user.AuthHash))
        {
            var (failures, lockedUntil) = accounts.RecordFailedLogin(user.Id);
            if (lockedUntil is { } until && until > DateTime.UtcNow)
            {
                log.LogWarning("Account {UserId} locked after {Failures} failed logins", user.Id, failures);
                return Locked(until);
            }
            return InvalidCredentials();
        }

        if (user.Disabled) return Err(403, "this account is disabled");
        if (user.FailedLogins > 0 || user.LockedUntil != null) accounts.ResetFailures(user.Id);
        return Ok(BuildSession(user));
    }

    // POST /api/account/refresh -> 200 rotated session | 401
    [HttpPost("refresh")]
    public IActionResult Refresh([FromBody] RefreshRequest? req)
    {
        if (req is null || !IsBoundedText(req.RefreshToken, MaxTokenChars)) return Err(400, "refreshToken is required");

        var (newToken, newHash) = tokens.NewRefreshToken();
        var result = accounts.RotateSession(tokens.HashRefresh(req.RefreshToken!), newHash);
        if (!result.Ok)
        {
            if (result.Reused)
                log.LogWarning("Refresh token reuse detected for user {UserId}; session {SessionId} revoked", result.UserId, result.SessionId);
            return StatusCode(401, new { error = "invalid refresh token" });
        }

        var user = accounts.FindById(result.UserId!);
        if (user is null || user.Disabled)
        {
            if (result.SessionId != null) accounts.RevokeSession(result.SessionId);
            return StatusCode(401, new { error = "invalid refresh token" });
        }

        var (access, expiresIn) = tokens.IssueAccess(user); // current role from the database
        return Ok(SessionPayload(user, access, newToken, expiresIn));
    }

    // POST /api/account/logout (auth) -> 204. Revokes the caller's own session identified by its refresh token.
    [Authorize]
    [HttpPost("logout")]
    public IActionResult Logout([FromBody] RefreshRequest? req)
    {
        var userId = User.FindFirst("sub")?.Value;
        if (userId is null) return Unauthorized();
        if (req is null || !IsBoundedText(req.RefreshToken, MaxTokenChars)) return Err(400, "refreshToken is required");

        accounts.RevokeSessionByRefreshHash(tokens.HashRefresh(req.RefreshToken!), userId);
        return NoContent();
    }

    // ---- change password ---------------------------------------------------------------

    // POST /api/account/change-password (auth) -> 200 new session. Revokes every existing session
    // (including the caller's); the client adopts the returned session.
    [Authorize]
    [HttpPost("change-password")]
    public IActionResult ChangePassword([FromBody] ChangePasswordRequest? req)
    {
        var userId = User.FindFirst("sub")?.Value;
        if (userId is null) return Unauthorized();
        if (req is null) return Err(400, "request body is required");

        if (!TryDecode(req.CurrentAuthKey, out var currentKey) || currentKey.Length != AuthKeyBytes) return Err(400, "invalid currentAuthKey");
        if (!TryParseCredentials(req.Salt, req.Iterations, req.AuthKey, req.WrappedPrivateKey, req.WrappedContainerKey,
                out var newKey, out var error)) return Err(400, error);

        var user = accounts.FindById(userId);
        if (user is null) return Unauthorized();
        if (user.Disabled) return Err(403, "this account is disabled");
        if (IsLocked(user)) return Locked(user.LockedUntil!.Value);

        if (!PasswordHasher.Verify(currentKey, user.AuthHash))
        {
            var (failures, lockedUntil) = accounts.RecordFailedLogin(user.Id);
            if (lockedUntil is { } until && until > DateTime.UtcNow)
            {
                log.LogWarning("Account {UserId} locked after {Failures} failed password-change attempts", user.Id, failures);
                return Locked(until);
            }
            return InvalidCredentials();
        }

        accounts.UpdateCredentials(user.Id, req.Salt!, req.Iterations, PasswordHasher.Hash(newKey),
            req.WrappedPrivateKey!, req.WrappedContainerKey!);
        accounts.RevokeAllSessions(user.Id);
        log.LogInformation("Password changed for {UserId}; all sessions revoked", user.Id);

        return Ok(BuildSession(accounts.FindById(user.Id)!));
    }

    // ---- session building --------------------------------------------------------------

    private object BuildSession(UserRecord user)
    {
        var (refresh, hash) = tokens.NewRefreshToken();
        accounts.CreateSession(user.Id, hash);
        var (access, expiresIn) = tokens.IssueAccess(user);
        return SessionPayload(user, access, refresh, expiresIn);
    }

    private static object SessionPayload(UserRecord user, string access, string refresh, int expiresIn) => new
    {
        accessToken = access,
        refreshToken = refresh,
        expiresIn,
        user = new { id = user.Id, username = user.Username, role = user.Role },
        salt = user.Salt,
        iterations = user.Iterations,
        publicKey = user.PublicKey,
        wrappedPrivateKey = user.WrappedPrivateKey,
        wrappedContainerKey = user.WrappedContainerKey,
    };

    // ---- results -----------------------------------------------------------------------

    private IActionResult Err(int status, string? message) => StatusCode(status, new { error = message });

    // One shared body for "unknown user" and "wrong key" so they are byte-identical.
    private IActionResult InvalidCredentials() => StatusCode(401, new { error = "invalid username or password" });

    private IActionResult Locked(DateTime lockedUntilUtc)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling((lockedUntilUtc - DateTime.UtcNow).TotalSeconds));
        Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        return StatusCode(423, new { error = "account temporarily locked", retryAfterSeconds = seconds });
    }

    private static bool IsLocked(UserRecord user) => user.LockedUntil is { } until && until > DateTime.UtcNow;

    // ---- validation --------------------------------------------------------------------

    private static bool TryParseCreate(CreateAccountRequest req, string role, out NewUser user, out string error)
    {
        user = null!;
        if (!TryNormalizeUsername(req.Username, out var name)) { error = "username must be 3-64 characters with no control characters"; return false; }
        if (!TryDecode(req.PublicKey, out _)) { error = "invalid publicKey"; return false; }
        if (!TryParseCredentials(req.Salt, req.Iterations, req.AuthKey, req.WrappedPrivateKey, req.WrappedContainerKey,
                out var authKey, out error)) return false;

        user = new NewUser(name, role, req.Salt!, req.Iterations, PasswordHasher.Hash(authKey),
            req.PublicKey!, req.WrappedPrivateKey!, req.WrappedContainerKey!);
        error = "";
        return true;
    }

    private static bool TryParseCredentials(string? salt, int iterations, string? authKeyB64, string? wrappedPrivateKey,
                                            string? wrappedContainerKey, out byte[] authKey, out string error)
    {
        authKey = [];
        if (!TryDecode(salt, out var saltBytes) || saltBytes.Length != SaltBytes) { error = "salt must be 16 bytes of base64"; return false; }
        if (iterations < MinIterations || iterations > MaxIterations) { error = $"iterations must be between {MinIterations} and {MaxIterations}"; return false; }
        if (!TryDecode(authKeyB64, out authKey) || authKey.Length != AuthKeyBytes) { error = "authKey must be 32 bytes of base64"; return false; }
        if (!TryDecode(wrappedPrivateKey, out _)) { error = "invalid wrappedPrivateKey"; return false; }
        if (!TryDecode(wrappedContainerKey, out _)) { error = "invalid wrappedContainerKey"; return false; }
        error = "";
        return true;
    }

    /// <summary>Strict base64: non-empty, bounded, no whitespace, decodes cleanly.</summary>
    private static bool TryDecode(string? s, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrEmpty(s) || s.Length > MaxFieldChars) return false;
        foreach (var c in s) if (char.IsWhiteSpace(c)) return false;
        var buffer = new byte[s.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64String(s, buffer, out var written) || written == 0) return false;
        bytes = buffer[..written];
        return true;
    }

    private static bool IsBoundedText(string? s, int max) => !string.IsNullOrWhiteSpace(s) && s.Length <= max;

    /// <summary>NFC-normalises and trims; 3-64 chars; no control or line/paragraph separator characters.</summary>
    private static bool TryNormalizeUsername(string? raw, out string name)
    {
        name = "";
        if (string.IsNullOrEmpty(raw) || raw.Length > MaxUsernameChars * 4) return false;
        for (var i = 0; i < raw.Length; i++) // reject lone surrogates up front; Normalize does not always throw for them
        {
            if (char.IsHighSurrogate(raw[i]) && i + 1 < raw.Length && char.IsLowSurrogate(raw[i + 1])) i++;
            else if (char.IsSurrogate(raw[i])) return false;
        }
        string normalized;
        try { normalized = raw.Normalize(NormalizationForm.FormC).Trim(); }
        catch (ArgumentException) { return false; } // malformed Unicode (e.g. lone surrogate)
        if (normalized.Length < MinUsernameChars || normalized.Length > MaxUsernameChars) return false;
        foreach (var c in normalized)
        {
            // U+FFFD is what invalid UTF-8/UTF-16 decodes to: treat it as malformed input.
            if (char.IsControl(c) || c == '�') return false;
            var cat = char.GetUnicodeCategory(c);
            if (cat is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator) return false;
        }
        name = normalized;
        return true;
    }

    private static bool ConstantTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(a)),
            SHA256.HashData(Encoding.UTF8.GetBytes(b)));

    // Stable per-username fake salt: indistinguishable from a real 16-byte random salt, and the same on every call.
    private string FakeSalt(string normalizedUsername)
    {
        var key = Encoding.UTF8.GetBytes(JwtKeyResolver.Resolve(config, env));
        var mac = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(normalizedUsername.ToLowerInvariant()));
        return Convert.ToBase64String(mac, 0, SaltBytes);
    }
}
