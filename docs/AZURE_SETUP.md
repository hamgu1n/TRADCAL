# Azure AD Setup — TRADCAL Technician Appointment Board

This app displays upcoming appointments from a shared Outlook calendar on a
monitor in the technician area, with alarms at 30/15/5 minutes before each
appointment. It reads the calendar via the Microsoft Graph API using an
unattended (app-only) service identity — no user ever signs in on the kiosk
machine. This document covers the Azure AD / Microsoft 365 admin steps
needed to allow that.

## What you're granting

An app registration with **application-level** `Calendars.Read` permission,
scoped down (via RBAC for Applications) to read only **one shared mailbox's
calendar** — not every mailbox in the tenant.

## 1. Register the app

1. Go to the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID**.
2. **App registrations** → **New registration**.
3. Name: `TRADCAL Technician Board`.
4. Supported account types: **Accounts in this organizational directory only** (single tenant).
5. Redirect URI: leave blank.
6. **Register**.

Reference: [Register an application with the Microsoft identity platform](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)

From the app's **Overview** page, note:
- **Application (client) ID**
- **Directory (tenant) ID**

## 2. Create a client secret

1. **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Set an expiry (12–24 months; will need rotating before it expires).
3. Copy the secret **Value** immediately — it's shown only once.

Reference: [Get access without a user (client credentials flow)](https://learn.microsoft.com/en-us/graph/auth-v2-service)

## 3. Add API permission

1. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** (not Delegated — there's no signed-in user).
2. Search for and select **Calendars.Read**.
3. **Add permissions**.
4. Click **Grant admin consent for [organization]** and confirm. Requires Global Admin or Privileged Role Admin.

References:
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Overview of Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview)

## 4. Restrict the app to only the shared technician calendar

By default, application-level `Calendars.Read` grants read access to **every**
mailbox in the tenant. Use **RBAC for Applications** (Exchange Online) to
scope it down to just the one shared mailbox the board reads from.

Reference: [Role Based Access Control for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)

```powershell
# Connect to Exchange Online (requires Exchange admin rights)
Connect-ExchangeOnline

# Create a management scope limited to the one shared mailbox
New-ManagementScope -Name "TRADCAL-CalendarScope" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'techboard@yourcompany.com'"

# Create a management role assignment policy scoped to that mailbox,
# and assign it to the app's service principal (identified by its
# Application (client) ID from step 1)
New-ManagementRoleAssignment -App "<AZURE_CLIENT_ID>" `
  -Role "Application Mail.Read" `
  -CustomResourceScope "TRADCAL-CalendarScope"
```

Replace `techboard@yourcompany.com` with the actual shared mailbox address,
and `<AZURE_CLIENT_ID>` with the Application (client) ID from step 1. Exact
role name may need adjusting for calendar vs. mail scope — follow the current
guidance on the RBAC for Applications page linked above, since Microsoft has
been migrating this feature and cmdlet names/roles may be updated.

> Older guidance describes a `New-ApplicationAccessPolicy` cmdlet for this.
> Microsoft now documents that as legacy in favor of RBAC for Applications
> above — no need to use it for a new setup.

## 5. Confirm the shared mailbox address

Microsoft 365 admin center → **Teams & groups → Shared mailboxes** → confirm
the primary SMTP address of the calendar the board should read from.

## What to send back to IT/the requester

Once the above is done, provide these four values back (send the secret
value through a secure channel, not plain email/chat):

| Value | Where to find it |
|---|---|
| Tenant ID | App registration → Overview |
| Client (Application) ID | App registration → Overview |
| Client secret value | Certificates & secrets (copy at creation time only) |
| Shared mailbox address | Microsoft 365 admin center → Shared mailboxes |

These go into the app's `.env` file (see `.env.example` in the repo root) as
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and
`CALENDAR_MAILBOX`.
