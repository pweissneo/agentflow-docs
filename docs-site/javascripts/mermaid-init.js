// Initialize Mermaid diagrams — bypasses Material theme's broken auto-init.
// Uses fence_div_format to produce <div class="mermaid"> blocks that Mermaid
// processes directly via mermaid.run().
document.addEventListener("DOMContentLoaded", function () {
  var scheme = document.body.getAttribute("data-md-color-scheme");
  mermaid.initialize({
    startOnLoad: false,
    theme: scheme === "slate" ? "dark" : "default",
  });
  mermaid.run({ querySelector: ".mermaid" });
});
