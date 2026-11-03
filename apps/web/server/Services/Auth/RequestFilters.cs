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
    public const long DefaultMaxPageBytes = 16_777_216;    // 16 MiB of ciphertext per changes page
    public const long DefaultMaxUserBytes = 1_073_741_824; // 1 GiB of item ciphertext per user
    public const long JsonOverheadBytes = 4096;            // fixed room for the JSON envelope around one ciphertext

    public static long MaxBytes(IConfiguration cfg) => Positive(cfg["Items:MaxBytes"], DefaultMaxBytes);
    public static long MaxBatchBytes(IConfiguration cfg) => Positive(cfg["Items:MaxBatchBytes"], DefaultMaxBatchBytes);
    public static long MaxPageBytes(IConfiguration cfg) => Positive(cfg["Items:MaxPageBytes"], DefaultMaxPageBytes);
    public static long MaxUserBytes(IConfiguration cfg) => Positive(cfg["Items:MaxUserBytes"], DefaultMaxUserBytes);

    /// <summary>
    /// Largest request body accepted for a single ciphertext write: the ciphertext limit plus 1/6 headroom for
    /// JSON string escaping (a serialiser may write '+' as +) plus a fixed envelope allowance. This only
    /// bounds what is read; the exact limit is still enforced on the decoded ciphertext.
    /// </summary>
    public static long MaxSingleBodyBytes(IConfiguration cfg)
    {
        var max = MaxBytes(cfg);
        return max + max / 6 + JsonOverheadBytes;
    }

    private static long Positive(string? raw, long fallback) =>
        long.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var v) && v > 0
            ? v : fallback;
}

/// <summary>
/// Caps the request body before it is buffered. <c>Items:MaxBytes</c> (plus envelope overhead) for a single
/// item or prefs write (see <see cref="ItemLimits.MaxSingleBodyBytes"/>), <c>Items:MaxBatchBytes</c> for a batch. Enforced both via the server's per-request
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
        var limit = batch ? ItemLimits.MaxBatchBytes(cfg) : ItemLimits.MaxSingleBodyBytes(cfg);

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

/// <summary>
/// Ciphertext is client-produced base64 or base64url text, so the only characters it may contain are
/// A-Z a-z 0-9 + / = _ -. Rejecting everything else at write time means the stored bytes equal the JSON text
/// that is sent back (no characters that a serialiser would expand), which keeps byte budgets honest.
/// </summary>
public static class CiphertextRules
{
    private static readonly System.Buffers.SearchValues<char> Alphabet = System.Buffers.SearchValues.Create(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-");

    /// <summary>True for a non-empty string made only of base64 / base64url characters.</summary>
    public static bool IsValid([System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? ciphertext) =>
        !string.IsNullOrEmpty(ciphertext) && !ciphertext.AsSpan().ContainsAnyExcept(Alphabet);
}

/// <summary>
/// Serialises the controller's object results with relaxed JSON escaping, so '+' and '/' (all over base64
/// ciphertext) are written as themselves instead of the 6-byte \u002B form. Without this a response page that is
/// within its byte budget could be several times larger on the wire.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RelaxedJsonEscapingAttribute : Attribute, IResultFilter
{
    private static readonly Microsoft.AspNetCore.Mvc.Formatters.SystemTextJsonOutputFormatter Formatter = new(
        new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver(),
        });

    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is ObjectResult result)
        {
            result.Formatters.Clear();
            result.Formatters.Add(Formatter);
        }
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
