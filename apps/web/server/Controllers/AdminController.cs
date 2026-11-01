using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using NexusMDWeb.Api.Data;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Admin-only invite and user management. The JWT role claim gates entry, and every call additionally
/// re-checks the caller against the database, so a demoted or disabled admin loses access immediately
/// instead of when their (up to 15 minute) access token expires. Invite codes are returned exactly once
/// at creation and are never listed or logged; user listings never expose credentials or key material.
/// </summary>
[ApiController]
[Route("api/admin")]
[Authorize(Roles = "admin")]
[RequestSizeLimit(1024)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[LiveAdminCheck]
public class AdminController(AccountRepository accounts, ILogger<AdminController> log) : ControllerBase
{
    public const int DefaultInviteTtlHours = 168;
    public const int MinInviteTtlHours = 1;
    public const int MaxInviteTtlHours = 720;

    public record CreateInviteRequest(int? TtlHours);

    // ---- live admin check --------------------------------------------------------------

    /// <summary>
    /// Runs after [Authorize] for every action: the token says "admin", the database must agree right now.
    /// A missing or disabled caller gets 401 (their token is effectively revoked); a demoted one gets 403.
    /// </summary>
    private sealed class LiveAdminCheckAttribute : Attribute, IActionFilter
    {
        public void OnActionExecuting(ActionExecutingContext context)
        {
            var repo = context.HttpContext.RequestServices.GetRequiredService<AccountRepository>();
            var id = context.HttpContext.User.FindFirst("sub")?.Value;
            var caller = id is null ? null : repo.FindById(id);
            if (caller is null || caller.Disabled)
                context.Result = new ObjectResult(new { error = "unauthorized" }) { StatusCode = 401 };
            else if (caller.Role != "admin")
                context.Result = new ObjectResult(new { error = "admin access required" }) { StatusCode = 403 };
        }

        public void OnActionExecuted(ActionExecutedContext context) { }
    }

    // ---- invites -----------------------------------------------------------------------

    // POST /api/admin/invites { ttlHours? } -> 201 { id, code, expiresAt }. The only time the code is ever shown.
    [HttpPost("invites")]
    public IActionResult CreateInvite([FromBody] CreateInviteRequest? req)
    {
        var ttlHours = req?.TtlHours ?? DefaultInviteTtlHours;
        if (ttlHours < MinInviteTtlHours || ttlHours > MaxInviteTtlHours)
            return Err(400, $"ttlHours must be between {MinInviteTtlHours} and {MaxInviteTtlHours}");

        var (id, code) = accounts.CreateInvite(CallerId()!, TimeSpan.FromHours(ttlHours));
        // Report the stored expiry so it matches the listing exactly.
        var expiresAt = accounts.ListInvites().FirstOrDefault(i => i.Id == id)?.ExpiresAt
                        ?? DateTime.UtcNow.AddHours(ttlHours);
        log.LogInformation("Admin {AdminId} created invite {InviteId} valid for {Hours}h", CallerId(), id, ttlHours);
        return StatusCode(StatusCodes.Status201Created, new { id, code, expiresAt });
    }

    // GET /api/admin/invites -> metadata for every non-revoked invite. Never the code or its hash.
    [HttpGet("invites")]
    public IActionResult ListInvites() =>
        Ok(accounts.ListInvites().Select(i => new
        {
            id = i.Id,
            createdBy = i.CreatedBy,
            createdAt = i.CreatedAt,
            expiresAt = i.ExpiresAt,
            redeemedAt = i.RedeemedAt,
        }));

    // DELETE /api/admin/invites/{id} -> 204 | 404 (unknown, malformed, already redeemed or already revoked)
    [HttpDelete("invites/{id}")]
    public IActionResult RevokeInvite(string id)
    {
        if (!TryNormalizeId(id, out var key) || !accounts.RevokeInvite(key)) return Err(404, "invite not found");
        log.LogInformation("Admin {AdminId} revoked invite {InviteId}", CallerId(), key);
        return NoContent();
    }

    // ---- users -------------------------------------------------------------------------

    // GET /api/admin/users -> [{ id, username, role, disabled, createdAt }]
    [HttpGet("users")]
    public IActionResult ListUsers() =>
        Ok(accounts.ListUsers().Select(u => new
        {
            id = u.Id,
            username = u.Username,
            role = u.Role,
            disabled = u.Disabled,
            createdAt = u.CreatedAt,
        }));

    // POST /api/admin/users/{id}/disable -> 204. Revokes all of the user's sessions. Not allowed on yourself.
    [HttpPost("users/{id}/disable")]
    public IActionResult Disable(string id)
    {
        if (!TryNormalizeId(id, out var key)) return Err(404, "user not found");
        if (string.Equals(key, CallerId(), StringComparison.OrdinalIgnoreCase)) return Err(400, "you cannot disable your own account");
        if (accounts.FindById(key) is null) return Err(404, "user not found");

        accounts.SetDisabled(key, true);
        log.LogInformation("Admin {AdminId} disabled user {UserId}", CallerId(), key);
        return NoContent();
    }

    // POST /api/admin/users/{id}/enable -> 204. Does not restore revoked sessions; the user logs in again.
    [HttpPost("users/{id}/enable")]
    public IActionResult Enable(string id)
    {
        if (!TryNormalizeId(id, out var key) || accounts.FindById(key) is null) return Err(404, "user not found");

        accounts.SetDisabled(key, false);
        log.LogInformation("Admin {AdminId} enabled user {UserId}", CallerId(), key);
        return NoContent();
    }

    // ---- helpers -----------------------------------------------------------------------

    private string? CallerId() => User.FindFirst("sub")?.Value;

    private IActionResult Err(int status, string message) => StatusCode(status, new { error = message });

    /// <summary>Ids are GUIDs stored in "N" format; anything else is simply "not found".</summary>
    private static bool TryNormalizeId(string? raw, out string id)
    {
        id = "";
        if (string.IsNullOrEmpty(raw) || raw.Length > 64 || !Guid.TryParse(raw, out var guid)) return false;
        id = guid.ToString("N");
        return true;
    }
}
