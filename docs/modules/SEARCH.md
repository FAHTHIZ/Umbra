# Umbra Search

- Config: `overlay/search/umbra-search-engines.json`, in Firefox's remote-settings search-config v2 format, shipped locally and never fetched.
- Default: OnionSearch.io (`https://onionsearch.io/search?q={searchTerms}`), for both normal and private windows.
- Providers: OnionSearch, DuckDuckGo, DuckDuckGo (no AI), DuckDuckGo onion, Brave, Brave onion, Startpage, Startpage onion, Ecosia, Google, Mojeek, Wikipedia.
- Suggestions: supported where the provider offers them, and **off by default** (`browser.search.suggest.enabled=false`), because they send every keystroke.
- Custom engines: Settings → Search → Add, or the home-page switcher. Any URL containing `%s` works.
- The search provider is separate from the network. Every provider, including Google, is reached over Tor. Choosing a provider decides who sees your queries, not whether Tor protects your IP address.
