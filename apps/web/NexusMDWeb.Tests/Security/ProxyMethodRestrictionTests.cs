using System.Net;
using System.Text;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests.Security;

/// <summary>
/// Verifies that the ADO transparent proxy only allows GET and POST requests.
///
/// Write operations (vote, comment, complete PR, create/edit WI) must go through
/// their own dedicated, audit-logged controllers — never through the open proxy.
/// Allowing PUT / PATCH / DELETE through the proxy would let the frontend make
/// arbitrary write calls to ADO using the server's PAT, bypassing audit logging
/// and any server-side validation.
/// </summary>
public class ProxyMethodRestrictionTests : IClassFixture<TestFactory>
{
    private readonly HttpClient _client;

    public ProxyMethodRestrictionTests(TestFactory factory)
    {
        _client = factory.CreateClient();
    }

    // ── Mutating verbs must be blocked ────────────────────────────────────────

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task Proxy_rejects_mutating_http_methods(string method)
    {
        var request = new HttpRequestMessage(
            new HttpMethod(method),
            $"/api/ado/{TestFactory.TestProject}/_apis/git/repositories/some-repo/pullRequests/1")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };

        var response = await _client.SendAsync(request);

        Assert.True(
            response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"Expected 404 or 405 for {method} via proxy, got {(int)response.StatusCode}");
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task Rejected_proxy_request_does_not_reach_ADO(string method)
    {
        // Fresh factory so call count starts at zero
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var request = new HttpRequestMessage(
            new HttpMethod(method),
            $"/api/ado/{TestFactory.TestProject}/_apis/anything")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };

        await client.SendAsync(request);

        // If the proxy correctly rejected the request, no outbound ADO call was made
        Assert.Empty(factory.FakeHandler.Calls);
    }

    // ── Read verbs must be allowed through ───────────────────────────────────

    [Fact]
    public async Task Proxy_allows_GET_requests()
    {
        var response = await _client.GetAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/workitems?ids=1&api-version=7.0");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Proxy_allows_POST_for_WIQL_queries()
    {
        var content = new StringContent(
            """{"query":"SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'TestProject'"}""",
            Encoding.UTF8, "application/json");

        var response = await _client.PostAsync(
            $"/api/ado/{TestFactory.TestProject}/_apis/wit/wiql?api-version=7.0",
            content);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Write endpoints are not accessible via the proxy route ───────────────

    [Fact]
    public async Task Cannot_vote_PR_via_proxy_route()
    {
        // The real vote endpoint is PUT /api/pullrequests/{project}/{repo}/{id}/vote
        // Attempting to vote through the proxy (PUT /api/ado/...) must be blocked
        var request = new HttpRequestMessage(
            HttpMethod.Put,
            $"/api/ado/{TestFactory.TestProject}/_apis/git/repositories/repo1/pullRequests/1/reviewers/user-guid")
        {
            Content = new StringContent("""{"vote":10}""", Encoding.UTF8, "application/json"),
        };

        var response = await _client.SendAsync(request);

        Assert.True(
            response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"PUT through proxy should be blocked, got {(int)response.StatusCode}");
    }

    [Fact]
    public async Task Cannot_update_work_item_via_proxy_route()
    {
        // The real update endpoint is PATCH /api/workitems/{id}
        // Attempting to patch through the proxy must be blocked
        var request = new HttpRequestMessage(
            HttpMethod.Patch,
            $"/api/ado/_apis/wit/workitems/42")
        {
            Content = new StringContent(
                """[{"op":"add","path":"/fields/System.State","value":"Active"}]""",
                Encoding.UTF8, "application/json"),
        };

        var response = await _client.SendAsync(request);

        Assert.True(
            response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"PATCH through proxy should be blocked, got {(int)response.StatusCode}");
    }
}