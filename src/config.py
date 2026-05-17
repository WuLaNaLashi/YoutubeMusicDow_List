from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"
DOWNLOADS_DIR = PROJECT_ROOT / "downloads"
LOGS_DIR = PROJECT_ROOT / "logs"
CACHE_DIR = PROJECT_ROOT / "cache"

SONGS_LIST = PROJECT_ROOT / "songs_list.txt"
SUCCESS_LOG = LOGS_DIR / "success.json"
FAILED_LOG = LOGS_DIR / "failed.json"
SEARCH_CACHE = CACHE_DIR / "search_cache.json"

FORMAT_PREFERENCE = "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio"
EMBED_THUMBNAIL = True
EMBED_METADATA = True

CONCURRENT_DOWNLOADS = 3
RETRY_TIMES = 3
RETRY_BACKOFF = [2, 8, 32]

SKIP_KEYWORDS = [
    # Karaoke / off-vocal
    "karaoke", "伴奏", "off vocal", "off-vocal", "(mr)", " mr ", "mr版",
    # Cover by others (note: bare "cover" is too aggressive — songs have "cover" in legit titles)
    "cover by", "翻唱", "翻唱版",
    # Piano / instrumental versions
    "piano cover", "piano version", "piano ver.", "piano ver",
    "钢琴版", "鋼琴版", "钢琴cover", "钢琴 cover",
    "纯音乐", "純音樂", "纯钢琴", "純鋼琴",
    "instrumental", "纯伴奏", "純伴奏",
    # Other unwanted variants
    "nightcore", "mmd", "8d audio", "sped up", "slowed",
    "配樂", "配乐",
]

# Artist names that indicate placeholder / cover artists, not the original singer.
# Keep tight — substring match is unforgiving.
SKIP_ARTIST_KEYWORDS = [
    "纯音乐", "純音樂",
    "配樂", "配乐",
    "karaoke", "instrumental",
    "music for u", "zzang karaoke",
]

# Soft penalty: still pick if nothing better, but prefer studio versions.
DEPRIORITIZE_KEYWORDS = [
    "live", "acoustic", "demo", "remix",
    "现场", "原声",
    "rehearsal", "reprise", "extended",
]
DEPRIORITIZE_PENALTY = 15
DURATION_MIN_SEC = 30
DURATION_MAX_SEC = 1200
SEARCH_LIMIT = 5

PROXY = None
COOKIES_FROM_BROWSER = None

TEST_SEED = 42
