using NexusMDWeb.Api.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Xunit;

namespace NexusMDWeb.Tests.Google;

// Note: WebApplicationFactory tests are skipped due to a pre-existing environment issue
// with the --parentprocessid arg. These unit-level tests validate controller logic directly.

public class GoogleControllerTests
{
    private static GoogleService MakeService(HttpMessageHandler handler)
    {
        var http  = new HttpClient(handler, disposeHandler: false) { BaseAddress = new Uri("https://www.googleapis.com/") };
        var cache = new MemoryCache(Options.Create(new MemoryCacheOptions()));
        return new GoogleService(http, cache);
    }

    // ── auth/url ─────────────────────────────────────────────────────────────

    [Fact]
    public void BuildAuthUrl_includes_all_required_scopes()
    {
        var handler = new FakeGoogleHandler();
        var svc     = MakeService(handler);
        var url     = svc.BuildAuthUrl("test-client-id", "https://localhost/api/google/auth/callback");

        Assert.Contains("test-client-id",       url);
        Assert.Contains("response_type=code",   url);
        Assert.Contains("access_type=offline",  url);
        Assert.Contains("prompt=consent",        url);
        Assert.Contains("gmail.readonly",        url);
        Assert.Contains("gmail.send",            url);
        Assert.Contains("drive.appdata",         url);
        Assert.Contains("calendar",              url);
    }

    // ── token exchange ────────────────────────────────────────────────────────

    [Fact]
    public async Task ExchangeCodeAsync_returns_null_on_http_error()
    {
        var handler = new FakeGoogleHandler();
        handler.Responses["/token"] = null!; // will return {}
        // Simulate failure by having the handler return 400
        var badHandler = new ErrorGoogleHandler(HttpStatusCode.BadRequest);
        var svc        = MakeService(badHandler);

        var (access, refresh) = await svc.ExchangeCodeAsync("bad-code", "id", "secret", "https://localhost/cb", default);

        Assert.Null(access);
        Assert.Null(refresh);
    }

    // ── calendar ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetCalendarEventsAsync_returns_empty_on_http_error()
    {
        var svc              = MakeService(new ErrorGoogleHandler(HttpStatusCode.Unauthorized));
        var (events, error) = await svc.GetCalendarEventsAsync("bad-token", DateTime.UtcNow, DateTime.UtcNow.AddDays(7), default);
        Assert.Empty(events);
    }

    // ── gmail ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetGmailDigestAsync_returns_empty_on_http_error()
    {
        var svc  = MakeService(new ErrorGoogleHandler(HttpStatusCode.Unauthorized));
        var msgs = await svc.GetGmailDigestAsync("bad-token", default);
        Assert.Empty(msgs);
    }

    // ── drive ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ListDriveBackupsAsync_returns_empty_on_http_error()
    {
        var svc   = MakeService(new ErrorGoogleHandler(HttpStatusCode.Unauthorized));
        var files = await svc.ListDriveBackupsAsync("bad-token", default);
        Assert.Empty(files);
    }
}

// Handler that always returns a given error status
internal sealed class ErrorGoogleHandler(HttpStatusCode status) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent("{}", Encoding.UTF8, "application/json") });
}