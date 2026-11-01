using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using NexusMDWeb.Api.Data;

namespace NexusMDWeb.Api.Services.Auth;

/// <summary>
/// For [Authorize]d controllers whose callers may be any role: the token says who the caller is, the database
/// must agree that the user still exists and is not disabled. A disabled user's still-valid access token is
/// therefore rejected immediately (401) instead of when it expires. This is a resource filter so it runs
/// before model binding: a rejected caller never gets a request body read. (AdminController keeps its own
/// stricter admin-role variant.)
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class LiveUserCheckAttribute : Attribute, IResourceFilter, IOrderedFilter
{
    public int Order { get; set; } = -100; // before the body limit and model binding

    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        var repo = context.HttpContext.RequestServices.GetRequiredService<AccountRepository>();
        var id = context.HttpContext.User.FindFirst("sub")?.Value;
        var caller = id is null ? null : repo.FindById(id);
        if (caller is null || caller.Disabled)
            context.Result = new ObjectResult(new { error = "unauthorized" }) { StatusCode = StatusCodes.Status401Unauthorized };
    }

    public void OnResourceExecuted(ResourceExecutedContext context) { }
}

/// <summary>Configurable limits for the encrypted item/prefs endpoints.</summary>
public static class ItemLimits
{
    public const long DefaultMaxBytes = 26_214_400;        // 25 MiB of ciphertext per item / prefs blob
    public const long DefaultMaxBatchBytes = 67_108_864;   // 64 MiB for a whole batch request body
    public const long JsonOverheadBytes = 4096;            // room for the JSON envelope around one ciphertext

    public static long MaxBytes(IConfiguration cfg) => Positive(cfg["Items:MaxBytes"], DefaultMaxBytes);
    public static long MaxBatchBytes(IConfiguration cfg) => Positive(cfg["Items:MaxBatchBytes"], DefaultMaxBatchBytes);

    private static long Positive(string? raw, long fallback) =>
        long.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var v) && v > 0
            ? v : fallback;
}

/// <summary>
/// Caps the request body before it is buffered. <c>Items:MaxBytes</c> (plus envelope overhead) for a single
/// item or prefs write, <c>Items:MaxBatchBytes</c> for a batch. Enforced both via the server's per-request
/// body-size feature (covers chunked uploads on Kestrel) and an up-front Content-Length check (413).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class ItemBodyLimitAttribute(bool batch) : Attribute, IResourceFilter, IOrderedFilter
{
    public int Order { get; set; } = -50;

    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        var http = context.HttpContext;
        var cfg = http.RequestServices.GetRequiredService<IConfiguration>();
        var limit = batch ? ItemLimits.MaxBatchBytes(cfg) : ItemLimits.MaxBytes(cfg) + ItemLimits.JsonOverheadBytes;

        if (http.Request.ContentLength is long len && len > limit)
        {
            context.Result = new ObjectResult(new { error = "request body too large" }) { StatusCode = StatusCodes.Status413PayloadTooLarge };
            return;
        }
        var feature = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = limit;
    }

    public void OnResourceExecuted(ResourceExecutedContext context) { }
}
