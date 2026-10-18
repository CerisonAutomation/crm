"use client";

import {
	ArrowRight,
	BarChart3,
	BriefcaseBusiness,
	ChevronRight,
	CircleUserRound,
	ClipboardList,
	FileText,
	LayoutDashboard,
	LogOut,
	Menu,
	Settings,
	UsersRound,
	X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { defaultViewFor, useApp, type View } from "@/lib/store";
import { cn } from "@/lib/utils";

const ClientOnboarding = dynamic(
	() =>
		import("@/features/client/client-portal").then((m) => m.ClientOnboarding),
	{ loading: Loading },
);
const ClientApply = dynamic(
	() => import("@/features/client/client-apply").then((m) => m.ClientApply),
	{ loading: Loading },
);
const ClientDashboard = dynamic(
	() =>
		import("@/features/client/client-portal").then((m) => m.ClientDashboard),
	{ loading: Loading },
);
const RmQueue = dynamic(
	() => import("@/features/rm/rm-console").then((m) => m.RmQueue),
	{ loading: Loading },
);
const RmCaseDetail = dynamic(
	() => import("@/features/rm/rm-console").then((m) => m.RmCaseDetail),
	{ loading: Loading },
);
const CrmWorkspace = dynamic(
	() => import("@/features/crm/crm-workspace").then((m) => m.CrmWorkspace),
	{ loading: Loading },
);
const AccountsWorkspace = dynamic(
	() =>
		import("@/features/crm/accounts-workspace").then(
			(m) => m.AccountsWorkspace,
		),
	{ loading: Loading },
);
const PotentialsWorkspace = dynamic(
	() =>
		import("@/features/crm/potentials-workspace").then(
			(m) => m.PotentialsWorkspace,
		),
	{ loading: Loading },
);
const SalesOrdersWorkspace = dynamic(
	() =>
		import("@/features/crm/sales-orders-workspace").then(
			(m) => m.SalesOrdersWorkspace,
		),
	{ loading: Loading },
);
const ProductsWorkspace = dynamic(
	() =>
		import("@/features/crm/products-workspace").then(
			(m) => m.ProductsWorkspace,
		),
	{ loading: Loading },
);
const SettingsView = dynamic(
	() => import("@/features/settings/settings-view").then((m) => m.SettingsView),
	{ loading: Loading },
);
const AdminDashboard = dynamic(
	() => import("@/features/admin/admin-console").then((m) => m.AdminDashboard),
	{ loading: Loading },
);
const AdminUsers = dynamic(
	() => import("@/features/admin/admin-console").then((m) => m.AdminUsers),
	{ loading: Loading },
);
const AdminOps = dynamic(
	() => import("@/features/admin/ops-panel").then((m) => m.AdminOps),
	{ loading: Loading },
);
const AdminRecords = dynamic(
	() => import("@/features/admin/records-panel").then((m) => m.AdminRecords),
	{ loading: Loading },
);

function Loading() {
	return (
		<div className="grid min-h-[24rem] place-items-center text-sm text-muted-foreground">
			Opening workspace…
		</div>
	);
}

type NavigationItem = {
	view: View;
	label: string;
	description: string;
	icon: typeof LayoutDashboard;
};

const clientNavigation: NavigationItem[] = [
	{
		view: "client-dashboard",
		label: "My case",
		description: "Your progress and next steps",
		icon: LayoutDashboard,
	},
	{
		view: "client-apply",
		label: "Applications",
		description: "Start or manage an application",
		icon: FileText,
	},
	{
		view: "settings",
		label: "Settings",
		description: "Profile, privacy, and preferences",
		icon: Settings,
	},
];

const staffNavigation: NavigationItem[] = [
	{
		view: "rm-queue",
		label: "Case queue",
		description: "Prioritised client work",
		icon: ClipboardList,
	},
	{
		view: "crm",
		label: "Relationship desk",
		description: "People, tasks, and activity",
		icon: UsersRound,
	},
	{
		view: "accounts",
		label: "Accounts",
		description: "Organisations and relationships",
		icon: BriefcaseBusiness,
	},
	{
		view: "potentials",
		label: "Opportunities",
		description: "Potential client engagements",
		icon: BarChart3,
	},
	{
		view: "settings",
		label: "Settings",
		description: "Profile and workspace preferences",
		icon: Settings,
	},
];

const adminNavigation: NavigationItem[] = [
	{
		view: "admin-dashboard",
		label: "Overview",
		description: "Organisation health and priorities",
		icon: LayoutDashboard,
	},
	{
		view: "rm-queue",
		label: "Case queue",
		description: "Client work and assignments",
		icon: ClipboardList,
	},
	{
		view: "crm",
		label: "Relationship desk",
		description: "People, tasks, and activity",
		icon: UsersRound,
	},
	{
		view: "admin-users",
		label: "People",
		description: "Users and access",
		icon: CircleUserRound,
	},
	{
		view: "admin-ops",
		label: "Operations",
		description: "Operational controls",
		icon: BriefcaseBusiness,
	},
	{
		view: "admin-records",
		label: "Records",
		description: "Business records",
		icon: FileText,
	},
	{
		view: "settings",
		label: "Settings",
		description: "Your profile and preferences",
		icon: Settings,
	},
];

function navigationFor(role: string): NavigationItem[] {
	if (role === "CLIENT") return clientNavigation;
	if (role === "ADMIN") return adminNavigation;
	return staffNavigation;
}

function titleFor(view: View): string {
	const titles: Partial<Record<View, string>> = {
		"client-dashboard": "My case",
		"client-onboarding": "Your profile",
		"client-apply": "Applications",
		"rm-queue": "Case queue",
		"rm-case": "Case details",
		crm: "Relationship desk",
		accounts: "Accounts",
		potentials: "Opportunities",
		"sales-orders": "Sales orders",
		products: "Products",
		"admin-dashboard": "Overview",
		"admin-users": "People",
		"admin-ops": "Operations",
		"admin-records": "Records",
		settings: "Settings",
	};
	return titles[view] ?? "Workspace";
}

function UnsupportedView({ view, goHome }: { view: View; goHome: () => void }) {
	return (
		<section
			className="mx-auto max-w-2xl px-5 py-14 md:px-8"
			aria-labelledby="workspace-heading"
		>
			<p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">
				Citizen Lane workspace
			</p>
			<h1
				id="workspace-heading"
				className="mt-3 font-editorial text-3xl text-cobble-ink"
			>
				This area is being rebuilt
			</h1>
			<p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
				The previous workspace bundled unrelated tools into one unstable shell.
				This view now returns you to the focused workspace while the underlying
				workflow is rebuilt.
			</p>
			<Button className="mt-7 min-h-11" onClick={goHome}>
				Return to your workspace{" "}
				<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
			</Button>
			<p className="sr-only">Current view: {view}</p>
		</section>
	);
}

function WorkspaceView({ view, home }: { view: View; home: () => void }) {
	switch (view) {
		case "client-onboarding":
			return <ClientOnboarding />;
		case "client-dashboard":
			return <ClientDashboard />;
		case "client-apply":
			return <ClientApply />;
		case "rm-queue":
			return <RmQueue />;
		case "rm-case":
			return <RmCaseDetail />;
		case "crm":
			return <CrmWorkspace />;
		case "accounts":
			return <AccountsWorkspace />;
		case "potentials":
			return <PotentialsWorkspace />;
		case "sales-orders":
			return <SalesOrdersWorkspace />;
		case "products":
			return <ProductsWorkspace />;
		case "admin-dashboard":
			return <AdminDashboard />;
		case "admin-users":
			return <AdminUsers />;
		case "admin-ops":
			return <AdminOps />;
		case "admin-records":
			return <AdminRecords />;
		case "settings":
			return <SettingsView />;
		default:
			return <UnsupportedView view={view} goHome={home} />;
	}
}

export function PageShell() {
	const { session, view, setView, logout } = useApp();
	const [menuOpen, setMenuOpen] = useState(false);
	const items = useMemo(
		() => navigationFor(session?.role ?? "CLIENT"),
		[session?.role],
	);

	if (!session) return null;

	const goHome = () => setView(defaultViewFor(session));
	const navigate = (next: View) => {
		setView(next);
		setMenuOpen(false);
	};

	return (
		<div className="min-h-screen bg-background">
			<a
				href="#workspace-main"
				className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-gold focus:px-4 focus:py-3 focus:text-cobble-ink"
			>
				Skip to content
			</a>
			<header className="sticky top-0 z-40 border-b border-[#24405A] bg-cobble text-[#F5F1EA]">
				<div className="mx-auto flex min-h-16 max-w-[1600px] items-center justify-between gap-3 px-4 md:px-6">
					<button
						type="button"
						onClick={goHome}
						className="flex min-h-11 items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
					>
						<span className="grid h-9 w-9 place-items-center rounded-full border border-gold/60 font-editorial text-lg text-gold">
							CL
						</span>
						<span>
							<span className="block font-editorial text-base tracking-[0.16em]">
								CITIZEN LANE
							</span>
							<span className="block text-[10px] uppercase tracking-[0.16em] text-[#B7C3CE]">
								Private client services
							</span>
						</span>
					</button>
					<div className="hidden items-center gap-4 md:flex">
						<div className="text-right">
							<p className="text-sm font-medium">{session.name}</p>
							<p className="text-xs text-[#B7C3CE]">{session.email}</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							className="min-h-11 min-w-11 text-[#F5F1EA] hover:bg-[#1B3A54] hover:text-[#F5F1EA]"
							onClick={() => void logout()}
							aria-label="Sign out"
						>
							<LogOut className="h-4 w-4" />
						</Button>
					</div>
					<Button
						variant="ghost"
						size="icon"
						className="min-h-11 min-w-11 text-[#F5F1EA] hover:bg-[#1B3A54] hover:text-[#F5F1EA] md:hidden"
						onClick={() => setMenuOpen((open) => !open)}
						aria-expanded={menuOpen}
						aria-controls="workspace-navigation"
						aria-label={menuOpen ? "Close navigation" : "Open navigation"}
					>
						{menuOpen ? (
							<X className="h-5 w-5" />
						) : (
							<Menu className="h-5 w-5" />
						)}
					</Button>
				</div>
			</header>
			<div className="mx-auto flex max-w-[1600px]">
				<aside
					id="workspace-navigation"
					className={cn(
						"fixed inset-x-0 top-16 z-30 border-b border-border bg-card p-3 shadow-lg md:sticky md:top-16 md:block md:h-[calc(100vh-4rem)] md:w-72 md:shrink-0 md:border-b-0 md:border-r md:p-5 md:shadow-none",
						menuOpen ? "block" : "hidden",
					)}
				>
					<nav aria-label="Workspace navigation" className="space-y-1">
						<p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
							Workspace
						</p>
						{items.map((item) => {
							const Icon = item.icon;
							const active =
								view === item.view ||
								(view === "rm-case" && item.view === "rm-queue");
							return (
								<button
									key={item.view}
									type="button"
									onClick={() => navigate(item.view)}
									aria-current={active ? "page" : undefined}
									className={cn(
										"flex min-h-12 w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										active
											? "bg-cobble text-[#F5F1EA]"
											: "text-iron-ink hover:bg-muted hover:text-cobble-ink",
									)}
								>
									<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
									<span className="min-w-0">
										<span className="block text-sm font-medium">
											{item.label}
										</span>
										<span
											className={cn(
												"block text-xs",
												active ? "text-[#B7C3CE]" : "text-muted-foreground",
											)}
										>
											{item.description}
										</span>
									</span>
									<ChevronRight
										className="ml-auto h-4 w-4 shrink-0 opacity-60"
										aria-hidden="true"
									/>
								</button>
							);
						})}
					</nav>
					<div className="mt-5 border-t border-border pt-4 md:hidden">
						<Button
							variant="outline"
							className="w-full min-h-11"
							onClick={() => void logout()}
						>
							<LogOut className="mr-2 h-4 w-4" />
							Sign out
						</Button>
					</div>
				</aside>
				<main
					id="workspace-main"
					tabIndex={-1}
					className="min-w-0 flex-1 scroll-mt-20"
				>
					<div className="border-b border-border/70 bg-card px-5 py-4 md:px-8">
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-ink">
							Citizen Lane
						</p>
						<h1 className="mt-1 font-editorial text-2xl text-cobble-ink">
							{titleFor(view)}
						</h1>
					</div>
					<WorkspaceView view={view} home={goHome} />
				</main>
			</div>
		</div>
	);
}
