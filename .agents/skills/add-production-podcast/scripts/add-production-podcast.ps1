param(
  [string]$PodcastId = "",
  [string]$EpisodeId = "",
  [string]$ExpectedTitle = "",
  [string]$SearchQuery = "",
  [string]$BaseUrl = "http://175.178.130.174"
)

$ErrorActionPreference = "Stop"

function Assert-XiaoyuzhouId {
  param(
    [string]$Value,
    [string]$Label
  )
  if ($Value -notmatch "^[a-f0-9]{24}$") {
    throw "$Label must be a 24-character lowercase hex Xiaoyuzhou ID: $Value"
  }
}

function Invoke-Json {
  param([string]$Url)
  Write-Host "> GET $Url"
  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 45
  if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) {
    throw "HTTP $($response.StatusCode) from $Url"
  }
  return $response.Content | ConvertFrom-Json
}

$BaseUrl = $BaseUrl.TrimEnd("/")

if (!$PodcastId -and !$EpisodeId) {
  throw "Provide -PodcastId or -EpisodeId."
}

if (!$PodcastId) {
  Assert-XiaoyuzhouId -Value $EpisodeId -Label "EpisodeId"
  $episodeResult = Invoke-Json "$BaseUrl/api/episode/$EpisodeId"
  $PodcastId = $episodeResult.podcast.id
  if (!$PodcastId) {
    throw "Episode did not expose a podcast id."
  }
  Write-Host "Discovered podcast id from episode: $PodcastId"
}

Assert-XiaoyuzhouId -Value $PodcastId -Label "PodcastId"

$podcastResult = Invoke-Json "$BaseUrl/api/podcast/$PodcastId"
$podcast = $podcastResult.podcast
if (!$podcast.id) {
  throw "Podcast response did not contain podcast metadata."
}

if ($ExpectedTitle -and $podcast.title -ne $ExpectedTitle) {
  throw "Podcast title mismatch. Expected '$ExpectedTitle', got '$($podcast.title)'."
}

if (!$SearchQuery) {
  $SearchQuery = $podcast.title
}

$encodedQuery = [System.Uri]::EscapeDataString($SearchQuery)
$searchResult = Invoke-Json "$BaseUrl/api/search?q=$encodedQuery"
$containsPodcast = @($searchResult.podcasts | Where-Object { $_.id -eq $PodcastId }).Count -gt 0
if ($searchResult.source -ne "database" -or !$containsPodcast) {
  throw "Podcast was fetched but database search did not return it for query '$SearchQuery'."
}

[PSCustomObject]@{
  inserted = [PSCustomObject]@{
    id = $podcast.id
    title = $podcast.title
    author = $podcast.author
    episodeCount = $podcast.episodeCount
    sourceUrl = $podcast.sourceUrl
  }
  search = [PSCustomObject]@{
    query = $SearchQuery
    source = $searchResult.source
    count = @($searchResult.podcasts).Count
    containsPodcast = $containsPodcast
  }
} | ConvertTo-Json -Depth 5
