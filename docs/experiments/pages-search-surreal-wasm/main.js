let worker;
const log = document.querySelector("#log");
function start(action, count) {
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
  worker.postMessage({ action, count });
}
document.querySelector("#small").onclick = () => start("build", 100);
document.querySelector("#large").onclick = () => start("build", 1000);
document.querySelector("#reopen").onclick = () => start("reopen");
document.querySelector("#update").onclick = () => start("update");

document.querySelector("#memory").onclick = () => start("memory", 1000);
