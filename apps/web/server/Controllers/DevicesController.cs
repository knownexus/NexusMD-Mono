using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Models;
using NexusMDWeb.Api.Services.Auth;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// The caller's registered devices and each device's encrypted prefs blob. Everything is scoped to the user id
/// in the token's <c>sub</c> claim: another user's (or a malformed) device id is a plain 404, never a 403 or a
/// 500, so ids cannot be probed. Prefs are opaque client-encrypted ciphertext and are never logged.
///
/// Contract (pinned):
///  - <c>updatedAt</c> is Unix milliseconds (UTC) everywhere in this controller.
///  - <c>PUT /api/devices/{id}/prefs</c> returns <c>{ revision }</c> only; <c>GET</c> returns <c>{ revision, ciphertext }</c>.
///  - Creating a device beyond the per-user cap is 409 with <c>code: "device_limit"</c>.
///  - Prefs ciphertext must be non-empty base64/base64url (400 otherwise); responses use relaxed JSON escaping.
/// </summary>
[ApiController]
[Route("api/devices")]
[Authorize] // any role; fail closed
[LiveUserCheck]
[RelaxedJsonEscaping]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class DevicesController(AccountRepository accounts, IConfiguration config, ILogger<DevicesController> log) : ControllerBase
{
    public const int MaxNameChars = 64;
    private static readonly string[] Platforms = ["windows", "android", "web", "other"];

    public record CreateDeviceRequest(string? Name, string? Platform);
    public record RenameDeviceRequest(string? Name);
    public record PutPrefsRequest(string? Ciphertext);

    // GET /api/devices -> [{ id, name, platform, updatedAt }]
    [HttpGet]
    public IActionResult List() => Ok(accounts.ListDevices(CallerId()).Select(Shape));

    // POST /api/devices { name, platform } -> 201 { id, name, platform, updatedAt } | 400 | 409 { code: "device_limit" }
    [HttpPost]
    [RequestSizeLimit(4096)]
    public IActionResult Create([FromBody] CreateDeviceRequest? req)
    {
        if (req is null) return Err(400, "request body is required");
        if (!TryNormalizeName(req.Name, out var name)) return Err(400, $"name must be 1-{MaxNameChars} characters with no control characters");
        if (req.Platform is null || !Platforms.Contains(req.Platform, StringComparer.Ordinal))
            return Err(400, "platform must be one of: " + string.Join(", ", Platforms));

        var device = accounts.CreateDevice(CallerId(), name, req.Platform);
        if (device is null)
            return StatusCode(StatusCodes.Status409Conflict,
                new { error = $"a user can have at most {AccountRepository.MaxDevicesPerUser} devices", code = "device_limit" });
        log.LogInformation("User {UserId} registered device {DeviceId}", CallerId(), device.Id);
        return StatusCode(StatusCodes.Status201Created, Shape(device));
    }

    // PUT /api/devices/{id} { name } -> 200 { id, name, platform, updatedAt } | 400 | 404
    [HttpPut("{id}")]
    [RequestSizeLimit(4096)]
    public IActionResult Rename(string id, [FromBody] RenameDeviceRequest? req)
    {
        if (!TryNormalizeId(id, out var key)) return Err(404, "device not found");
        if (req is null) return Err(400, "request body is required");
        if (!TryNormalizeName(req.Name, out var name)) return Err(400, $"name must be 1-{MaxNameChars} characters with no control characters");

        var device = accounts.RenameDevice(CallerId(), key, name);
        return device is null ? Err(404, "device not found") : Ok(Shape(device));
    }

    // DELETE /api/devices/{id} -> 204 | 404
    [HttpDelete("{id}")]
    public IActionResult Delete(string id)
    {
        if (!TryNormalizeId(id, out var key) || !accounts.DeleteDevice(CallerId(), key)) return Err(404, "device not found");
        log.LogInformation("User {UserId} removed device {DeviceId}", CallerId(), key);
        return NoContent();
    }

    // GET /api/devices/{id}/prefs -> { revision, ciphertext } (0 and "" when never written) | 404
    [HttpGet("{id}/prefs")]
    public IActionResult GetPrefs(string id)
    {
        if (!TryNormalizeId(id, out var key)) return Err(404, "device not found");
        var prefs = accounts.GetDevicePrefs(CallerId(), key);
        return prefs is null ? Err(404, "device not found") : Ok(new { revision = prefs.Value.revision, ciphertext = prefs.Value.ciphertext });
    }

    // PUT /api/devices/{id}/prefs { ciphertext } + If-Match: <revision> -> { revision } | 400 | 404 | 409 | 413
    [HttpPut("{id}/prefs")]
    [ItemBodyLimit(batch: false)]
    public IActionResult PutPrefs(string id, [FromBody] PutPrefsRequest? req)
    {
        if (!TryNormalizeId(id, out var key)) return Err(404, "device not found");
        if (!TryReadIfMatch(Request, out var expected)) return Err(400, "If-Match must be the current revision (a non-negative integer)");
        if (string.IsNullOrEmpty(req?.Ciphertext)) return InvalidCiphertext();
        if (Encoding.UTF8.GetByteCount(req.Ciphertext) > ItemLimits.MaxBytes(config)) return Err(413, "ciphertext is too large");
        if (!CiphertextRules.IsValid(req.Ciphertext)) return InvalidCiphertext();

        var result = accounts.PutDevicePrefs(CallerId(), key, expected, req.Ciphertext);
        switch (result.Status)
        {
            case WriteStatus.NotFound: return Err(404, "device not found");
            case WriteStatus.Conflict: return StatusCode(StatusCodes.Status409Conflict, new { error = "revision conflict", code = "conflict" });
            default:
                log.LogInformation("Device {DeviceId} prefs updated to revision {Revision}", key, result.Revision);
                return Ok(new { revision = result.Revision });
        }
    }

    // ---- helpers -----------------------------------------------------------------------

    private string CallerId() => User.FindFirst("sub")?.Value ?? "";

    private IActionResult Err(int status, string message) => StatusCode(status, new { error = message });

    private IActionResult InvalidCiphertext() =>
        StatusCode(StatusCodes.Status400BadRequest, new { error = "ciphertext must be a non-empty base64 or base64url string", code = "invalid_ciphertext" });

    private static object Shape(DeviceRecord d) => new { id = d.Id, name = d.Name, platform = d.Platform, updatedAt = d.UpdatedAt };

    /// <summary>Device ids are GUIDs stored in "N" format; anything else is simply "not found".</summary>
    private static bool TryNormalizeId(string? raw, out string id)
    {
        id = "";
        if (string.IsNullOrEmpty(raw) || raw.Length > 64 || !Guid.TryParse(raw, out var guid)) return false;
        id = guid.ToString("N");
        return true;
    }

    /// <summary>NFC-normalised, trimmed, 1-64 chars, no control, format, line/paragraph separator or unpaired surrogate characters.</summary>
    internal static bool TryNormalizeName(string? raw, out string name)
    {
        name = "";
        if (raw is null || raw.Length > MaxNameChars * 4) return false;
        string s;
        try { s = raw.Normalize(NormalizationForm.FormC).Trim(); }
        catch (ArgumentException) { return false; } // invalid (unpaired surrogate) sequence
        if (s.Length is < 1 or > MaxNameChars) return false;
        foreach (var c in s)
        {
            switch (char.GetUnicodeCategory(c))
            {
                case UnicodeCategory.Control:
                case UnicodeCategory.Format:
                case UnicodeCategory.LineSeparator:
                case UnicodeCategory.ParagraphSeparator:
                case UnicodeCategory.PrivateUse:
                case UnicodeCategory.OtherNotAssigned:
                    return false;
            }
        }
        name = s;
        return true;
    }

    /// <summary>If-Match carries the expected revision as a non-negative integer (optionally quoted like an ETag).</summary>
    internal static bool TryReadIfMatch(HttpRequest request, out long revision)
    {
        revision = 0;
        var raw = request.Headers.IfMatch.ToString().Trim().Trim('"');
        return raw.Length is > 0 and <= 18
            && long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out revision);
    }
}
