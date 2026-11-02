# NexusMD API image (ASP.NET Core 8, SQLite). Build context is the REPOSITORY ROOT:
#   docker build -f apps/web/Dockerfile -t nexusmd-api .
# The Vite frontend is not built here (-p:SkipFrontend=true); the image serves the API only.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
# Restore first so the package layer is cached when only source changes.
COPY apps/web/server/NexusMDWeb.Api.csproj apps/web/server/
RUN dotnet restore apps/web/server/NexusMDWeb.Api.csproj
COPY apps/web/server/ apps/web/server/
RUN dotnet publish apps/web/server/NexusMDWeb.Api.csproj -c Release -p:SkipFrontend=true --no-restore -o /out

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /out .

# SQLite databases live on the volume Railway mounts at /data (single replica only).
RUN mkdir -p /data
ENV Accounts__DbPath=/data/accounts.db \
    Profiles__DbPath=/data/profiles.db \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0

# Railway injects PORT; fall back to 8080 for local runs. ASPNETCORE_URLS is computed at start (shell form),
# and "Urls" is set too because appsettings.json carries a "Urls" key (localhost:5200) that would otherwise
# take precedence over ASPNETCORE_URLS.
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "-c", "export ASPNETCORE_URLS=\"http://0.0.0.0:${PORT:-8080}\" Urls=\"http://0.0.0.0:${PORT:-8080}\"; exec dotnet NexusMDWeb.Api.dll"]
