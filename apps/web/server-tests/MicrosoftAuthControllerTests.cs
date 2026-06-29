using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Services.OAuth;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class MicrosoftAuthControllerTests
{
    private sealed class FakeExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse("at-ms", "rt-ms", 3600));
    }

    // Simulates a non-error HTTP response that carries no access_token.
    private sealed class EmptyExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse(null, null, 0));
    }

    private static WebApplicationFactory<Program> WithFake(TestFactory f) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<ITokenExchanger>(new FakeExchanger())));

    private static WebApplicationFactory<Program> WithExchanger(TestFactory f, ITokenExchanger ex) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton(ex)));

    [Fact]
    public async Task Url_contains_graph_scope_and_no_secret()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/ms/auth/url?redirectUri=" + Uri.EscapeDataString("https://app/?from=onedrive"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("login.microsoftonline.com", url);
        Assert.Contains("Files.ReadWrite", url);
        Assert.DoesNotContain("test-ms-secret", url);
    }

    [Fact]
    public async Task Callback_exchanges_code_for_tokens()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/ms/auth/callback",
            new { code = "abc", redirectUri = "https://app/?from=onedrive" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-ms", j.GetProperty("accessToken").GetString());
        Assert.Equal("rt-ms", j.GetProperty("refreshToken").GetString());
    }

    [Fact]
    public async Task Refresh_returns_a_new_access_token()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/ms/auth/refresh", new { refreshToken = "rt-ms" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-ms", j.GetProperty("accessToken").GetString());
    }

    [Fact]
    public async Task Callback_returns_502_when_no_access_token_comes_back()
    {
        using var f = new TestFactory();
        var client = WithExchanger(f, new EmptyExchanger()).CreateClient();
        var res = await client.PostAsJsonAsync("/api/ms/auth/callback",
            new { code = "abc", redirectUri = "https://app/?from=onedrive" });
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
    }
}
