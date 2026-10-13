import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Table, type TableConfig } from "./table";

type Organization = { id: string; name: string; slug: string; role: string; invitations: number };

const config: TableConfig<Organization> = {
  caption: "Organizations",
  columns: [
    { id: "name", header: "Organization", cell: (row) => <a className="text-link" href={`/dashboard/organizations/${row.slug}`}>{row.name}</a> },
    { id: "slug", header: "Slug", cell: (row) => <span className="organization-slug">{row.slug}</span> },
    { id: "role", header: "Your role", cell: (row) => <span className={`organization-role organization-role-${row.role}`}>{row.role}</span> },
    { id: "invitations", header: "Pending invitations", align: "right", cell: (row) => row.invitations },
  ],
  rows: [
    { id: "1", name: "Example workspace", slug: "example", role: "owner", invitations: 2 },
    { id: "2", name: "Design team", slug: "design-team", role: "admin", invitations: 0 },
    { id: "3", name: "Engineering", slug: "engineering", role: "member", invitations: 0 },
  ],
  rowKey: (row) => row.id,
};

function OrganizationTable(props: { config: TableConfig<Organization> }) {
  return <Table {...props} />;
}

const meta = {
  title: "UI/Table",
  component: OrganizationTable,
  args: { config },
  parameters: { layout: "padded" },
} satisfies Meta<typeof OrganizationTable>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = { args: { config: { ...config, rows: [], emptyMessage: "No organizations yet. Create one to get started." } } };
export const Loading: Story = { args: { config: { ...config, state: "loading" } } };
export const Error: Story = { args: { config: { ...config, state: "error", errorMessage: "Could not load organizations. Please try again." } } };
export const LongContent: Story = { args: { config: {
  ...config,
  rows: [{ id: "long", name: "A workspace for an international product and engineering team", slug: "international-product-engineering-team", role: "owner", invitations: 12 }],
} } };
