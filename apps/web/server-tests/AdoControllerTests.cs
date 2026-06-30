using System.Net;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class AdoControllerTests : IClassFixture<TestFactory>
{
    private readonly TestFactory _factory;
    private readonly HttpClient _client;

    public AdoControllerTests(TestFactory factory)
    {
        _factory = factory;
        _client  = factory.CreateClient();
    }

    [Fact]
    public async Task Proxy_returns_401_if_not_configured()
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = false
        });
        
        var response = await client.GetAsync("/api/ado/_apis/projects?api-version=7.0");
        
        Assert.NotEqual(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Proxy_handles_POST()
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = false
        });

        var response = await client.PostAsync("/api/ado/proj/_apis/wit/wiql?api-version=7.0", 
            new StringContent("{\"query\":\"select * from workitems\"}", System.Text.Encoding.UTF8, "application/json"));
        
        Assert.NotEqual(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }
}
