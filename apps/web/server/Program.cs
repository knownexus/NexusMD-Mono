var builder = WebApplication.CreateBuilder(args);

// appsettings.user.json overrides appsettings.json — written by PUT /api/config from the UI
builder.Configuration.AddJsonFile(
    Path.Combine(builder.Environment.ContentRootPath, "appsettings.user.json"),
    optional: true,
    reloadOnChange: true);

// JWT bearer auth. Jwt:SigningKey must be >= 32 bytes; outside Development it is mandatory.
// Resolved lazily (after the host's final configuration is built) so that test hosts and
// environment overrides are honoured; validated eagerly right after builder.Build().
builder.Services
    .AddAuthentication(Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();
builder.Services
    .AddOptions<Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerOptions>(
        Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme)
    .Configure<IConfiguration, IHostEnvironment>((o, cfg, env) =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = NexusMDWeb.Api.Services.Auth.JwtKeyResolver.Issuer(cfg),
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(
                System.Text.Encoding.UTF8.GetBytes(NexusMDWeb.Api.Services.Auth.JwtKeyResolver.Resolve(cfg, env))),
            // MapInboundClaims=false keeps short claim names, so point the role/name lookups at them
            // (otherwise [Authorize(Roles=...)] would look for the long ClaimTypes.Role URI).
            NameClaimType = "unique_name",
            RoleClaimType = "role",
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
builder.Services.AddAuthorization();

// When behind a trusted reverse proxy (e.g. Railway) set Proxy:TrustForwardedHeaders=true to honour
// X-Forwarded-For/Proto so the client IP is the real one. Known networks/proxies are cleared because the proxy
// address is not known up front; ForwardLimit stays at its default of 1, so only the right-most
// (proxy-appended) X-Forwarded-For entry is used. Never enable this when the app is directly reachable.
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                       | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

// Per-client-IP fixed-window limit (default 20 requests/minute, RateLimit:PermitPerMinute) shared by the
// anonymous account endpoints. Read lazily so the host's final configuration (and test overrides) apply.
builder.Services.AddRateLimiter(o => o.RejectionStatusCode = StatusCodes.Status429TooManyRequests);
builder.Services
    .AddOptions<Microsoft.AspNetCore.RateLimiting.RateLimiterOptions>()
    .Configure<IConfiguration>((o, cfg) =>
    {
        var permit = cfg.GetValue("RateLimit:PermitPerMinute", 20);
        if (permit < 1) permit = 20;
        o.AddPolicy(NexusMDWeb.Api.Controllers.AccountController.AnonymousRateLimitPolicy, ctx =>
            System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
                {
                    PermitLimit = permit,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                }));
    });

builder.Services.AddControllers();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.OAuth.ITokenExchanger,
                              NexusMDWeb.Api.Services.OAuth.HttpTokenExchanger>();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.OAuth.IOneTimeCodeStore,
                              NexusMDWeb.Api.Services.OAuth.MemoryOneTimeCodeStore>();

// Profile registry (SQLite-backed) consumed by /api/profiles.
builder.Services.AddSingleton<NexusMDWeb.Api.Data.ProfileRepository>();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.ProfileService>();

// Accounts: SQLite store, password hashing (auth-key hash) and JWT/refresh token issuing.
builder.Services.AddSingleton<NexusMDWeb.Api.Data.AccountRepository>();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.Auth.TokenService>();

// Allow the apps to call the API. "nexus.app" is the Android WebView's virtual hostname (capacitor.config.json);
// "null" is the desktop app, whose Electron window is loaded from file:// and so sends "Origin: null";
// "nexusmd.app" is the web origin. Allowing "null" is safe because the API authenticates with a bearer token in
// the Authorization header, never a cookie: a page cannot act as a user without already holding their token.
builder.Services.AddCors(options =>
{
    options.AddPolicy("CapacitorApp", policy =>
    {
        policy.WithOrigins("https://nexusmd.app", "https://nexus.app", "null")
              .WithHeaders("Content-Type", "Authorization", "X-Requested-With")
              .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
    });
});

var app = builder.Build();
NexusMDWeb.Api.Services.Auth.JwtKeyResolver.Resolve(app.Configuration, app.Environment); // fail fast on a missing/short signing key

// Off by default: with KnownProxies/KnownNetworks cleared, any caller could spoof X-Forwarded-For. Enable
// (Proxy:TrustForwardedHeaders=true) only when a trusted reverse proxy fronts the app and is the sole way in.
if (app.Configuration.GetValue("Proxy:TrustForwardedHeaders", false))
{
    app.UseForwardedHeaders(); // must run first so everything downstream sees the real client IP/scheme
    // Some proxies append their own changing edge address as the last X-Forwarded-For entry (Railway sends
    // "<client>, <edge ip>"), which would give every request a fresh rate-limit partition. Proxy:ClientIpHeader
    // names a single-value header the proxy sets to the client address itself (Railway: X-Real-IP); when it holds
    // a valid IP it replaces the address taken from X-Forwarded-For. Only read while forwarded headers are trusted.
    var clientIpHeader = app.Configuration["Proxy:ClientIpHeader"];
    if (!string.IsNullOrWhiteSpace(clientIpHeader))
        app.Use((ctx, next) =>
        {
            var value = ctx.Request.Headers[clientIpHeader].ToString();
            if (System.Net.IPAddress.TryParse(value.Split(',')[0].Trim(), out var ip))
                ctx.Connection.RemoteIpAddress = ip;
            return next(ctx);
        });
}
app.UseCors("CapacitorApp");
// Diagnostics: a SqliteException that escapes a request (e.g. SQLITE_BUSY under contention) becomes a bare 500.
// Record which error it was. Only the error codes and the matched route are logged: no message, SQL, parameters or ids.
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Microsoft.Data.Sqlite.SqliteException ex)
    {
        ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("NexusMDWeb.Sqlite").LogWarning(
            "SQLite error escaped {Method} {Endpoint}: code {Code}, extended code {ExtendedCode}",
            ctx.Request.Method, ctx.GetEndpoint()?.DisplayName ?? "(no endpoint)", ex.SqliteErrorCode, ex.SqliteExtendedErrorCode);
        throw;
    }
});

app.UseMiddleware<NexusMDWeb.Api.Services.Auth.LegacyEndpointGate>();

// Serve the single-page frontend from wwwroot/
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapFallbackToFile("index.html");
app.Run();

// Exposed so the integration test project can spin up the host via WebApplicationFactory<Program>.
public partial class Program { }
