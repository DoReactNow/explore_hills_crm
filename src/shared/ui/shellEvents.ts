// Signals between the app frame and dialogs other modules mount into it, so neither imports the other.
export const OPEN_SEARCH_EVENT = "eh:open-search";

export function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
