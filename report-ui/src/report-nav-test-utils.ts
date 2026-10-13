import { fireEvent, screen, within } from "@testing-library/react";

type Chapter = "Summary" | "QA" | "Design" | "Changes" | "Decisions";
export const chapterButton = (name: Chapter) => within(screen.getByRole("group", { name: "Report chapters" })).getByRole("button", { name: new RegExp(`^${name}\\b`) });
export const openChapter = (name: Chapter) => fireEvent.click(chapterButton(name));
