let worker;
const log = document.querySelector("#log");
function start(action) {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (data.progress !== undefined)
      document.querySelector("#progress").value = data.progress;
    else log.textContent += "\n" + JSON.stringify(data, null, 2);
  };
  worker.onerror = (e) => (log.textContent += "\nWORKER ERROR " + e.message);
  worker.postMessage({ action });
}
for (const action of ["build", "reopen", "update", "remove"])
  document.querySelector("#" + action).onclick = () => start(action);
