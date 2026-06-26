using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests.Security;

/// <summary>
/// Verifies that the PAT (Personal Access Token) never appears in any API
/// response — body or headers — regardless of which endpoint is called.
///
/// The PAT is a server-side secret stored in appsettings.json.  It is used
/// exclusively to authenticate outbound requests to Azure DevOps; it must
/// never be returned to the browser.
/// </summary>
public class PatNotExposedTests : IClassFixture<TestFactory>
{
    private readonly HttpClient _client;

    // The sentinel PAT value configured in TestFactory
    private const string Pat = TestFactory.TestPat;

    public PatNotExposedTests(TestFactory factory)
    {
        _client = factory.CreateClient();
    }

    // ── Response body checks ──────────────────────────────────────────────────

    [Fact]
    public async Task Config_endpoint_body_does_not_contain_pat()
    {
        var response = await _client.GetAsync("/api/config");
        var body     = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(Pat, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Config_endpoint_returns_org_but_not_pat()
    {
        var response = await _client.GetAsync("/api/config");
        var body     = await response.Content.ReadAsStringAsync();

        // org should be present (the frontend needs it)
        Assert.Contains(TestFactory.TestOrg, body);
        // PAT must not be present
        Assert.DoesNotContain(Pat, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Audit_endpoint_body_does_not_contain_pat()
    {
        var response = await _client.GetAsync("/api/audit");
        var body     = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(Pat, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Me_endpoint_body_does_not_contain_pat()
    {
        // /api/me proxies _apis/connectionData — the fake handler returns {}
        var response = await _client.GetAsync("/api/me");
        var body     = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(Pat, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Proxy_endpoint_body_does_not_contain_pat()
    {
        var response = await _client.GetAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?api-version=7.0");
        var body = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(Pat, body, StringComparison.OrdinalIgnoreCase);
    }

    // ── Response header checks ────────────────────────────────────────────────

    [Theory]
    [InlineData("/api/config")]
    [InlineData("/api/audit")]
    [InlineData("/api/me")]
    public async Task Response_headers_do_not_contain_pat(string url)
    {
        var response = await _client.GetAsync(url);

        var allHeaders = response.Headers
            .Concat(response.Content.Headers)
            .SelectMany(h => h.Value);

        foreach (var value in allHeaders)
        {
            Assert.DoesNotContain(Pat, value, StringComparison.OrdinalIgnoreCase);
        }
    }

    // ── Structural check: config shape ────────────────────────────────────────

    [Fact]
    public async Task Config_response_contains_exactly_the_expected_fields()
    {
        var response = await _client.GetAsync("/api/config");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync();

        // These keys should be present
        Assert.Contains("\"org\"",          body);
        Assert.Contains("\"projects\"",     body);
        Assert.Contains("\"testProject\"",  body);
        Assert.Contains("\"refreshSecs\"",  body);

        // PAT should not be present, even under a different key name
        Assert.DoesNotContain("\"pat\"",    body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"token\"",  body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"secret\"", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"key\"",    body, StringComparison.OrdinalIgnoreCase);
    }
}