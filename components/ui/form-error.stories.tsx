import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { FormError } from "./form-error";

const meta = {
  title: "UI/FormError",
  component: FormError,
  args: { children: "Could not save your changes. Please try again." },
} satisfies Meta<typeof FormError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent(
      "Could not save your changes. Please try again.",
    );
  },
};
export const LongMessage: Story = {
  args: {
    children:
      "This organization name is already in use. Choose a different name and try again; your other form values have been preserved.",
  },
};
