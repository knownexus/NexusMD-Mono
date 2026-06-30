using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text;

namespace NexusMDWeb.Api.Controllers;

[ApiController]
[Route("api/ado")]
public class AdoController(IConfiguration config, IHttpClientFactory httpClientFactory) : ControllerBase
{
    [HttpGet("{*path}")]
    [HttpPost("{*path}")]
    [HttpPut("{*path}")]
    [HttpPatch("{*path}")]
    [HttpDelete("{*path}")]
    public async Task Proxy(string? path)
    {
        var org = config["Ado:Organisation"];
        var pat = config["Ado:Pat"];

        if (string.IsNullOrWhiteSpace(org) || string.IsNullOrWhiteSpace(pat))
        {
            Response.StatusCode = 401;
            await Response.WriteAsJsonAsync(new { error = "ADO Organisation or PAT not configured" });
            return;
        }

        var client = httpClientFactory.CreateClient();
        
        // ADO requires Basic auth with PAT: "username:PAT" where username can be empty
        var authBytes = Encoding.ASCII.GetBytes($":{pat}");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(authBytes));

        var query = Request.QueryString.Value;
        var targetUrl = $"https://dev.azure.com/{org}/{path}{query}";

        var requestMessage = new HttpRequestMessage(new HttpMethod(Request.Method), targetUrl);

        if (Request.ContentLength > 0)
        {
            requestMessage.Content = new StreamContent(Request.Body);
            if (Request.ContentType != null)
            {
                requestMessage.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(Request.ContentType);
            }
        }

        // Forward headers if needed, but be careful with host etc.
        // For now, let's just forward the essential ones or let HttpClient handle it.

        try
        {
            using var responseMessage = await client.SendAsync(requestMessage, HttpCompletionOption.ResponseHeadersRead, HttpContext.RequestAborted);
            
            Response.StatusCode = (int)responseMessage.StatusCode;
            
            foreach (var header in responseMessage.Headers)
            {
                Response.Headers[header.Key] = header.Value.ToArray();
            }

            foreach (var header in responseMessage.Content.Headers)
            {
                Response.Headers[header.Key] = header.Value.ToArray();
            }

            // Remove problematic headers
            Response.Headers.Remove("transfer-encoding");
            Response.Headers.Remove("set-cookie");

            await responseMessage.Content.CopyToAsync(Response.Body);
        }
        catch (Exception ex)
        {
            Response.StatusCode = 502;
            await Response.WriteAsJsonAsync(new { error = "Proxy error", message = ex.Message });
        }
    }
}
