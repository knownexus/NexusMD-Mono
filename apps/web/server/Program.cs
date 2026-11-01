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

// The app runs behind a reverse proxy (Railway). Honour X-Forwarded-For/Proto so the client IP is the real
// one. Known networks/proxies are cleared because the proxy address is not known up front; ForwardLimit stays
// at its default of 1, so only the right-most (proxy-appended) X-Forwarded-For entry is used and a
// client-supplied header cannot spoof its address. Set Proxy:TrustForwardedHeaders=false when not behind a proxy.
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

// Allow the Capacitor Android app to call the API. "nexus.app" is the
// WebView's virtual hostname (capacitor.config.json); "nexusmd.app" is the
// deployed API/web origin used as the desktop/app VITE_API_BASE default.
builder.Services.AddCors(options =>
{
    options.AddPolicy("CapacitorApp", policy =>
    {
        policy.WithOrigins("https://nexusmd.app", "https://nexus.app")
              .WithHeaders("Content-Type", "Authorization", "X-Requested-With")
              .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
    });
});

var app = builder.Build();
NexusMDWeb.Api.Services.Auth.JwtKeyResolver.Resolve(app.Configuration, app.Environment); // fail fast on a missing/short signing key

if (app.Configuration.GetValue("Proxy:TrustForwardedHeaders", true))
    app.UseForwardedHeaders(); // must run first so everything downstream sees the real client IP/scheme
app.UseCors("CapacitorApp");
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
