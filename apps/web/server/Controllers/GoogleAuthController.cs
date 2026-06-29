using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Services.OAuth;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Brokers Google OAuth so the client secret stays server-side. Drive scope
/// (drive.file) is requested for profile cloud sync. Web is same-origin: the SPA
/// receives the code on its own redirect and POSTs it to /callback.
/// </summary>
[ApiController]
[Route("api/google/auth")]
public class GoogleAuthController(IConfiguration config, ITokenExchanger exchanger, IOneTimeCodeStore otc) : ControllerBase
{
    private const string AuthEndpoint  = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string Scope = "openid email https://www.googleapis.com/auth/drive.file";

    [HttpGet("url")]
    public IActionResult GetAuthUrl([FromQuery] string redirectUri)
    {
        var clientId = config["Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(redirectUri))
            return BadRequest(new { error = "google oauth not configured" });
        var q = new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["redirect_uri"]  = redirectUri,
            ["response_type"] = "code",
            ["scope"]         = Scope,
            ["access_type"]   = "offline",
            ["prompt"]        = "consent",
        };
        var url = AuthEndpoint + "?" + string.Join("&",
            q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return Ok(new { url });
    }

    [HttpPost("callback")]
    public async Task<IActionResult> Callback([FromBody] CallbackRequest req)
    {
        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["code"]          = req.Code,
            ["client_id"]     = config["Google:ClientId"] ?? "",
            ["client_secret"] = config["Google:ClientSecret"] ?? "",
            ["redirect_uri"]  = req.RedirectUri,
            ["grant_type"]    = "authorization_code",
        });
        if (string.IsNullOrEmpty(t.AccessToken))
            return StatusCode(502, new { error = "google did not return an access token" });
        return Ok(new { accessToken = t.AccessToken, refreshToken = t.RefreshToken });
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest req)
    {
        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["refresh_token"] = req.RefreshToken,
            ["client_id"]     = config["Google:ClientId"] ?? "",
            ["client_secret"] = config["Google:ClientSecret"] ?? "",
            ["grant_type"]    = "refresh_token",
        });
        if (string.IsNullOrEmpty(t.AccessToken))
            return StatusCode(502, new { error = "google did not return an access token" });
        return Ok(new { accessToken = t.AccessToken });
    }

    private const string NativeProvider = "google";

    private static string EncodeState(string returnUri)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(returnUri))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string DecodeState(string state)
    {
        var s = state.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(s));
    }

    private bool ReturnUriAllowed(string returnUri)
    {
        var prefixes = config.GetSection("OAuth:NativeReturnPrefixes").Get<string[]>() ?? [];
        return prefixes.Any(p => returnUri.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }

    private string NativeRedirectUri()
        => $"{Request.Scheme}://{Request.Host}/api/google/auth/native-callback";

    [HttpGet("native-url")]
    public IActionResult NativeUrl([FromQuery] string returnUri)
    {
        var clientId = config["Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId)) return BadRequest(new { error = "google oauth not configured" });
        if (string.IsNullOrWhiteSpace(returnUri) || !ReturnUriAllowed(returnUri))
            return BadRequest(new { error = "returnUri not allowed" });
        var q = new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["redirect_uri"]  = NativeRedirectUri(),
            ["response_type"] = "code",
            ["scope"]         = Scope,
            ["access_type"]   = "offline",
            ["prompt"]        = "consent",
            ["state"]         = EncodeState(returnUri),
        };
        var url = AuthEndpoint + "?" + string.Join("&",
            q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return Ok(new { url });
    }

    [HttpGet("native-callback")]
    public async Task<IActionResult> NativeCallback([FromQuery] string code, [FromQuery] string state)
    {
        string returnUri;
        try { returnUri = DecodeState(state); } catch { return BadRequest(new { error = "bad state" }); }
        if (!ReturnUriAllowed(returnUri)) return BadRequest(new { error = "returnUri not allowed" });

        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["code"]          = code,
            ["client_id"]     = config["Google:ClientId"] ?? "",
            ["client_secret"] = config["Google:ClientSecret"] ?? "",
            ["redirect_uri"]  = NativeRedirectUri(),
            ["grant_type"]    = "authorization_code",
        });
        if (string.IsNullOrEmpty(t.AccessToken))
            return StatusCode(502, new { error = "google did not return an access token" });

        var otcCode = otc.Put(NativeProvider, new TokenPair(t.AccessToken, t.RefreshToken));
        var sep = returnUri.Contains('?') ? "&" : "?";
        return Redirect($"{returnUri}{sep}provider=gdrive&otc={Uri.EscapeDataString(otcCode)}");
    }

    [HttpPost("exchange")]
    public IActionResult Exchange([FromBody] ExchangeRequest req)
    {
        var tokens = otc.Redeem(NativeProvider, req.Code);
        if (tokens is null) return BadRequest(new { error = "invalid or expired code" });
        return Ok(new { accessToken = tokens.AccessToken, refreshToken = tokens.RefreshToken });
    }
}

public record CallbackRequest(string Code, string RedirectUri);
public record RefreshRequest(string RefreshToken);
public record ExchangeRequest(string Code);
