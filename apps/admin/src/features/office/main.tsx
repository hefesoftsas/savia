import { createRoot } from "react-dom/client";
import { OfficePage } from "./office-page";
import "./office.css";
// One engine per document. This entry never initializes the admin PWA.
createRoot(document.getElementById("root")!).render(<OfficePage />);
