import { explain } from "chrome://browser/content/umbra-investigate/investigate-core.mjs";

const p = new URLSearchParams(location.search);
document.getElementById("url").textContent = p.get("u") || "";
document.getElementById("reason").textContent = explain(p.get("r") || "clearnet-blocked");
if (p.get("from")) {
  const f = document.getElementById("from");
  f.hidden = false;
  f.textContent = "Redirected from: " + p.get("from");
}
document.getElementById("back").addEventListener("click", () => history.back());
document.getElementById("dash").addEventListener("click", () => {
  location.href = "chrome://browser/content/umbra-investigate/investigate.html";
});
