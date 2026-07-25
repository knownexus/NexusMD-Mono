using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Proxies Azure DevOps REST calls from the frontend to dev.azure.com, injecting
/// the server-held PAT so credentials are never exposed to the browser.
///
/// Route: GET|POST /api/ado/{**path}
///
/// The frontend's ado-client.js calls /api/ado/{encodedProject}/_apis/...
/// This controller strips the /api/ado/ prefix and forwards the remainder to
/// https://dev.azure.com/{org}/{path}?{queryString} with Basic auth.
/// </summary>
[ApiController]
[Route("api/ado")]
public class AdoController(
    IConfiguration config,
    IHttpClientFactory httpClientFactory,
    ILogger<AdoController> logger) : ControllerBase
{
    [HttpGet("{**path}")]
    public Task<IActionResult> Get(CancellationToken ct)
        => ProxyAsync(ct);

    [HttpPost("{**path}")]
    public Task<IActionResult> Post(CancellationToken ct)
        => ProxyAsync(ct);

    // ── Proxy ─────────────────────────────────────────────────────────────────

    private async Task<IActionResult> ProxyAsync(CancellationToken ct)
    {
        var org = config["Ado:Organisation"];
        var pat = config["Ado:Pat"];

        if (string.IsNullOrWhiteSpace(org) || string.IsNullOrWhiteSpace(pat))
        {
            logger.LogWarning("ADO proxy request rejected: Ado:Organisation or Ado:Pat is not configured");
            return StatusCode(503, new { error = "ADO is not configured on this server" });
        }

        // Use the raw encoded path to preserve any percent-encoded project/repo names.
        // GetEncodedPathAndQuery() returns e.g. "/api/ado/MyProject/_apis/build/builds?$top=15&..."
        var encodedFull = Request.GetEncodedPathAndQuery();
        const string prefix = "/api/ado/";
        var adoPath = encodedFull.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? encodedFull[prefix.Length..]
            : encodedFull.TrimStart('/');

        var targetUrl = $"https://dev.azure.com/{Uri.EscapeDataString(org)}/{adoPath}";

        logger.LogDebug("ADO proxy {Method} {TargetUrl}", Request.Method, targetUrl);

        var client = httpClientFactory.CreateClient();

        using var upstream = new HttpRequestMessage(new HttpMethod(Request.Method), targetUrl);
        upstream.Headers.Authorization = new AuthenticationHeaderValue(
            "Basic",
            Convert.ToBase64String(Encoding.ASCII.GetBytes($":{pat}")));

        if (Request.Method == HttpMethods.Post)
        {
            upstream.Content = new StreamContent(Request.Body);
            upstream.Content.Headers.ContentType =
                new MediaTypeHeaderValue(Request.ContentType ?? "application/json");
        }

        using var downstream = await client.SendAsync(
            upstream, HttpCompletionOption.ResponseHeadersRead, ct);

        if (!downstream.IsSuccessStatusCode)
        {
            logger.LogWarning(
                "ADO proxy {Method} {TargetUrl} returned {StatusCode}",
                Request.Method, targetUrl, (int)downstream.StatusCode);
        }

        var body        = await downstream.Content.ReadAsStringAsync(ct);
        var contentType = downstream.Content.Headers.ContentType?.ToString() ?? "application/json";

        var result = new ContentResult
        {
            Content     = body,
            ContentType = contentType,
            StatusCode  = (int)downstream.StatusCode,
        };
        return result;
    }
}
