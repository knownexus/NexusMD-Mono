using System.Net.Http.Headers;
using System.Text;

namespace NexusMDWeb.Api.Services;

/// <summary>
/// Typed HttpClient that wraps all outbound Azure DevOps REST calls.
/// PAT authentication is applied once at construction — controllers never touch credentials.
/// </summary>
public class AdoClient
{
    private readonly HttpClient _http;

    /// <summary>The ADO organisation name (used by controllers to build web links).</summary>
    public string Organisation { get; }

    public AdoClient(HttpClient http, IConfiguration config)
    {
        _http        = http;
        Organisation = config["Ado:Organisation"]
                       ?? throw new InvalidOperationException("Ado:Organisation is not set in appsettings.json.");

        var pat = config["Ado:Pat"]
                  ?? throw new InvalidOperationException("Ado:Pat is not set in appsettings.json.");

        // ADO Basic auth: base64(anything:PAT)
        var token = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{pat}"));
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", token);
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/json");

        _http.BaseAddress = new Uri($"https://dev.azure.com/{Uri.EscapeDataString(Organisation)}/");
        _http.Timeout     = TimeSpan.FromSeconds(config.GetValue<int>("Ado:TimeoutSeconds", 120));
    }

    // ── Read operations ───────────────────────────────────────────────────────

    public Task<HttpResponseMessage> GetAsync(string relPath, CancellationToken ct = default)
        => _http.GetAsync(relPath, ct);

    // ── Write operations ──────────────────────────────────────────────────────

    public Task<HttpResponseMessage> PostAsync(string relPath, HttpContent content, CancellationToken ct = default)
        => _http.PostAsync(relPath, content, ct);

    public async Task<HttpResponseMessage> PatchAsync(string relPath, HttpContent content, CancellationToken ct = default)
    {
        var req = new HttpRequestMessage(HttpMethod.Patch, relPath) { Content = content };
        return await _http.SendAsync(req, ct);
    }

    public Task<HttpResponseMessage> PutAsync(string relPath, HttpContent content, CancellationToken ct = default)
        => _http.PutAsync(relPath, content, ct);

    // ── VSSPS (profile/identity) calls use a different base URL ───────────────

    public async Task<HttpResponseMessage> GetVsspsAsync(string path, CancellationToken ct = default)
    {
        // Preserve auth headers but use vssps base URL
        var req = new HttpRequestMessage(HttpMethod.Get, $"https://app.vssps.visualstudio.com/{path}");
        req.Headers.Authorization = _http.DefaultRequestHeaders.Authorization;
        req.Headers.Accept.ParseAdd("application/json");
        return await _http.SendAsync(req, ct);
    }
}