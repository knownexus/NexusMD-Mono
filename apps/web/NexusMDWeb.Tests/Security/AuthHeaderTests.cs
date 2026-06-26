using System.Text;
using System.Text.Json;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests.Security;

/// <summary>
/// Verifies that AdoClient correctly authenticates every outbound request using
/// Basic auth with the configured PAT — and that the PAT is encoded correctly.
///
/// These tests also confirm the token is never sent in plain text, and that the
/// BaseAddress targets dev.azure.com specifically (not an arbitrary host).
/// </summary>
public class AuthHeaderTests
{
    private static string ExpectedToken(string pat)
        => Convert.ToBase64String(Encoding.ASCII.GetBytes($":{pat}"));

    // ── Basic auth header is always present ───────────────────────────────────

    [Fact]
    public async Task GET_proxy_request_carries_Basic_auth_header()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        await client.GetAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?api-version=7.0");

        var call = Assert.Single(factory.FakeHandler.Calls);
        var auth = call.RequestHeaders.Authorization;

        Assert.NotNull(auth);
        Assert.Equal("Basic", auth!.Scheme);
    }

    [Fact]
    public async Task POST_proxy_request_carries_Basic_auth_header()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        await client.PostAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/wiql?api-version=7.0",
            new StringContent("""{"query":"SELECT [System.Id] FROM WorkItems"}""",
                Encoding.UTF8, "application/json"));

        var call = Assert.Single(factory.FakeHandler.Calls);
        var auth = call.RequestHeaders.Authorization;

        Assert.NotNull(auth);
        Assert.Equal("Basic", auth!.Scheme);
    }

    [Fact]
    public async Task PUT_write_request_carries_Basic_auth_header()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { vote = 10, userId = "some-user-guid" });
        await client.PutAsync(
            $"/api/pullrequests/{TestFactory.TestProject}/some-repo/1/vote",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var call = Assert.Single(factory.FakeHandler.Calls);
        var auth = call.RequestHeaders.Authorization;

        Assert.NotNull(auth);
        Assert.Equal("Basic", auth!.Scheme);
    }

    [Fact]
    public async Task PATCH_write_request_carries_Basic_auth_header()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var ops = JsonSerializer.Serialize(new[]
        {
            new { op = "add", path = "/fields/System.State", value = "Active" },
        });
        await client.PatchAsync(
            "/api/workitems/1",
            new StringContent(ops, Encoding.UTF8, "application/json"));

        var call = Assert.Single(factory.FakeHandler.Calls);
        var auth = call.RequestHeaders.Authorization;

        Assert.NotNull(auth);
        Assert.Equal("Basic", auth!.Scheme);
    }

    // ── PAT encoding ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Auth_token_is_the_correct_base64_encoding_of_the_PAT()
    {
        // ADO Basic auth format: base64(":{pat}")
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        await client.GetAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?api-version=7.0");

        var call = Assert.Single(factory.FakeHandler.Calls);
        var auth = call.RequestHeaders.Authorization;

        Assert.Equal(ExpectedToken(TestFactory.TestPat), auth!.Parameter);
    }

    [Fact]
    public async Task PAT_plain_text_does_not_appear_in_the_Authorization_header()
    {
        // The raw PAT string must never appear; only its base64 encoding should
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        await client.GetAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?api-version=7.0");

        var call = Assert.Single(factory.FakeHandler.Calls);
        var parameter = call.RequestHeaders.Authorization!.Parameter ?? string.Empty;

        Assert.DoesNotContain(
            TestFactory.TestPat,
            parameter,
            StringComparison.Ordinal);
    }

    // ── BaseAddress is constrained to dev.azure.com ───────────────────────────

    [Fact]
    public async Task All_ADO_requests_target_dev_azure_com()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        // Trigger requests through both proxy and write endpoints
        await client.GetAsync($"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?api-version=7.0");
        await client.GetAsync("/api/me");

        foreach (var call in factory.FakeHandler.Calls)
        {
            Assert.Equal("dev.azure.com", call.RequestUri.Host);
        }
    }

    [Fact]
    public async Task ADO_request_URL_includes_the_configured_organisation()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        await client.GetAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?api-version=7.0");

        var call = Assert.Single(factory.FakeHandler.Calls);

        // URL should be https://dev.azure.com/{org}/...
        Assert.Contains(
            TestFactory.TestOrg,
            call.RequestUri.AbsoluteUri,
            StringComparison.OrdinalIgnoreCase);
    }

    // ── Auth header is consistent across request types ────────────────────────

    [Fact]
    public async Task All_write_endpoints_use_the_same_auth_token()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var expected = ExpectedToken(TestFactory.TestPat);

        // Vote
        await client.PutAsync(
            $"/api/pullrequests/{TestFactory.TestProject}/repo/1/vote",
            new StringContent(
                JsonSerializer.Serialize(new { vote = 10, userId = "guid" }),
                Encoding.UTF8, "application/json"));

        // Comment
        await client.PostAsync(
            $"/api/pullrequests/{TestFactory.TestProject}/repo/1/threads",
            new StringContent(
                JsonSerializer.Serialize(new { content = "hi" }),
                Encoding.UTF8, "application/json"));

        // Abandon
        await client.PatchAsync(
            $"/api/pullrequests/{TestFactory.TestProject}/repo/1",
            new StringContent(
                JsonSerializer.Serialize(new { status = "abandoned" }),
                Encoding.UTF8, "application/json"));

        // Update WI
        await client.PatchAsync(
            "/api/workitems/1",
            new StringContent(
                JsonSerializer.Serialize(new[] { new { op = "add", path = "/fields/System.State", value = "Active" } }),
                Encoding.UTF8, "application/json"));

        Assert.Equal(4, factory.FakeHandler.Calls.Count);

        foreach (var call in factory.FakeHandler.Calls)
        {
            var token = call.RequestHeaders.Authorization?.Parameter;
            Assert.Equal(expected, token);
        }
    }
}