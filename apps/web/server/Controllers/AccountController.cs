using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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
[Authorize] // fail closed: every action needs a bearer token unless it is explicitly [AllowAnonymous]
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

    /// <summary>Name of the per-IP fixed-window rate-limit policy for the anonymous endpoints (see Program.cs).</summary>
    public const string AnonymousRateLimitPolicy = "account-anon";

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
    [AllowAnonymous]
    [EnableRateLimiting(AnonymousRateLimitPolicy)]
    [HttpGet("status")]
    public IActionResult Status() => Ok(new { needsSetup = !accounts.AnyUser() });

    // GET /api/account/params?username= -> { salt, iterations }. Unknown users get a stable fake salt.
    [AllowAnonymous]
    [EnableRateLimiting(AnonymousRateLimitPolicy)]
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
    [AllowAnonymous]
    [EnableRateLimiting(AnonymousRateLimitPolicy)]
    [HttpPost("setup")]
    public IActionResult Setup([FromBody] CreateAccountRequest? req)
    {
        if (req is null) return Err(400, "request body is required");

        var configured = config["Accounts:SetupToken"];
        if (string.IsNullOrWhiteSpace(configured) || !ConstantTimeEquals(req.SetupToken ?? "", configured))
            return Err(403, "setup is not available");

        if (!TryParseCreate(req, "admin", out var newUser, out var error)) return Err(400, error);

        // The "no users yet" guard is part of the INSERT itself, so racing calls (even across processes) cannot both win.
        UserRecord? created;
        try { created = accounts.CreateFirstUser(newUser); }
        catch (DuplicateUsernameException) { created = null; }
        if (created is null) return Err(409, "setup has already been completed");

        log.LogInformation("Initial admin account {UserId} created", created.Id);
        return StatusCode(StatusCodes.Status201Created, BuildSession(created));
    }

    // POST /api/account/redeem -> 201 session. Invite-only registration.
    [AllowAnonymous]
    [EnableRateLimiting(AnonymousRateLimitPolicy)]
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
    [AllowAnonymous]
    [EnableRateLimiting(AnonymousRateLimitPolicy)]
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

        // Reserve the attempt atomically BEFORE verifying: a locked account is refused (423) without
        // verifying the key or touching the counter, and concurrent guesses cannot all pass a stale lock check.
        var (allowed, count, reservedLock) = accounts.TryReserveLoginAttempt(user.Id);
        if (!allowed) return reservedLock is { } held ? Locked(held) : InvalidCredentials();

        if (!PasswordHasher.Verify(authKey, user.AuthHash))
        {
            // The reservation already counted this failure; if it was the one that hit the limit, say so.
            if (reservedLock is { } until && until > DateTime.UtcNow)
            {
                log.LogWarning("Account {UserId} locked after {Failures} failed logins", user.Id, count);
                return Locked(until);
            }
            return InvalidCredentials();
        }

        if (user.Disabled) return Err(403, "this account is disabled");

        // The session is only created if the credentials we just verified against are still current.
        var (refresh, refreshHash) = tokens.NewRefreshToken();
        if (accounts.CreateSessionIfCredentialsCurrent(user.Id, refreshHash, user.AuthHash) is null)
            return InvalidCredentials();
        accounts.ResetFailuresIfCount(user.Id, count); // no-op if concurrent attempts have advanced the count
        var (access, expiresIn) = tokens.IssueAccess(user);
        return Ok(SessionPayload(user, access, refresh, expiresIn));
    }

    // POST /api/account/refresh -> 200 rotated session | 401
    [AllowAnonymous]
    [EnableRateLimiting(AnonymousRateLimitPolicy)]
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

        // Same atomic reservation as login, so currentAuthKey cannot be brute-forced through this endpoint.
        var (allowed, count, reservedLock) = accounts.TryReserveLoginAttempt(user.Id);
        if (!allowed) return reservedLock is { } held ? Locked(held) : InvalidCredentials();

        if (!PasswordHasher.Verify(currentKey, user.AuthHash))
        {
            if (reservedLock is { } until && until > DateTime.UtcNow)
            {
                log.LogWarning("Account {UserId} locked after {Failures} failed password-change attempts", user.Id, count);
                return Locked(until);
            }
            return InvalidCredentials();
        }

        // Credentials, revocation of every session and the new session commit together, and only if the
        // auth hash we verified against is still current. This also resets the failure counter.
        var (refresh, refreshHash) = tokens.NewRefreshToken();
        var sessionId = accounts.ChangeCredentials(user.Id, req.Salt!, req.Iterations, PasswordHasher.Hash(newKey),
            req.WrappedPrivateKey!, req.WrappedContainerKey!, refreshHash, expectedAuthHash: user.AuthHash);
        if (sessionId is null) return InvalidCredentials();
        log.LogInformation("Password changed for {UserId}; all other sessions revoked", user.Id);

        var fresh = accounts.FindById(user.Id);
        if (fresh is null) return Unauthorized();
        var (access, expiresIn) = tokens.IssueAccess(fresh);
        return Ok(SessionPayload(fresh, access, refresh, expiresIn));
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
        foreach (var c in normalized.EnumerateRunes())
        {
            if (!IsAllowedUsernameChar(c)) return false;
        }
        name = normalized;
        return true;
    }

    // Invisible letters that Unicode classifies as ordinary letters/symbols but render as blank.
    private const string InvisibleLookalikes = "\u115F\u1160\u2800\u3164\uFFA0";

    /// <summary>
    /// Rejects control, format (Cf, e.g. zero-width and bidi overrides), line/paragraph separators, private-use,
    /// unassigned, any space other than ASCII space, a few blank-looking letters, and U+FFFD (what invalid
    /// UTF-8/UTF-16 decodes to, i.e. malformed input).
    /// </summary>
    private static bool IsAllowedUsernameChar(Rune c)
    {
        if (c.Value == 0xFFFD || (c.IsBmp && InvisibleLookalikes.Contains((char)c.Value))) return false;
        return Rune.GetUnicodeCategory(c) is not (
            UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.LineSeparator
            or UnicodeCategory.ParagraphSeparator or UnicodeCategory.PrivateUse or UnicodeCategory.OtherNotAssigned
            or UnicodeCategory.Surrogate)
            && (c.Value == 0x20 || Rune.GetUnicodeCategory(c) != UnicodeCategory.SpaceSeparator);
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
