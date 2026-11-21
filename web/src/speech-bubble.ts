// Speech bubble
// =============
// Vendored from Cult UI's Speech Bubble
// (https://www.cult-ui.com/docs/components/speech-bubble, MIT): the bubble
// body, its SVG tail and the text slot are the component's asset. Only the
// class names are adapted to this app's plain CSS island, so the shape is
// not hand-drawn here.

export function speech_bubble(): { root: HTMLDivElement; text: HTMLSpanElement } {
  const root = document.createElement("div");
  root.className = "thought-card";
  root.setAttribute("data-slot", "speech-bubble");
  root.innerHTML = `<span class="thought-text" data-slot="speech-bubble-text"></span>
    <svg class="thought-tail" aria-hidden="true" fill="none" focusable="false" height="45" viewBox="0 0 53 45" width="53" xmlns="http://www.w3.org/2000/svg">
      <path d="M44 0H0V0C0 24.8528 20.1472 45 45 45H53V45C47.1396 36.535 44 26.4842 44 16.1886V0Z"></path>
    </svg>
    <button class="thought-close" type="button" aria-label="Dismiss thought" title="Dismiss thought">×</button>`;
  return { root, text: root.querySelector(".thought-text") as HTMLSpanElement };
}
