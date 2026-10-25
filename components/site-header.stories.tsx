import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import { SiteHeaderView } from "./site-header-view";

const meta = {
  title: "Layout/SiteHeader",
  component: SiteHeaderView,
  args: { config: { user: null, onSignOut: fn() } },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SiteHeaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Subtubes home" })).toHaveAttribute("href", "/");
    await expect(canvas.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    await expect(canvas.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    await expect(canvas.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/sign-up");
  },
};

const user = { name: "Alex Morgan", email: "alex@example.test" };
export const SignedIn: Story = { args: { config: { user, onSignOut: fn() } } };
export const Loading: Story = { args: { config: { user: null, loading: true, onSignOut: fn() } } };
export const SigningOut: Story = { args: { config: { user, signingOut: true, onSignOut: fn() } } };
export const SignOutError: Story = { args: { config: { user, error: "Could not sign out. Please try again.", onSignOut: fn() } } };
export const SessionError: Story = { args: { config: { user: null, error: "Could not load your session. Please retry.", onSignOut: fn(), onRetry: fn() } } };
