import { Resend } from "resend";
import { centsToDisplay } from "./utils";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

interface NotificationParams {
  recipientEmail: string;
  recipientName: string;
  createdByName: string;
  item: string;
  amountOwedCents: number;
  currentBalanceCents: number;
}

function buildEmailHtml(params: NotificationParams): string {
  const amountOwed = centsToDisplay(params.amountOwedCents);
  const balance = centsToDisplay(params.currentBalanceCents);
  const balanceColor = params.currentBalanceCents >= 0 ? "#10B981" : "#EF4444";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1E293B; margin-bottom: 16px;">New Expense Added</h2>
      <div style="background: #F8FAFC; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px;"><strong>${params.createdByName}</strong> added an expense:</p>
        <p style="margin: 0 0 8px; font-size: 18px; font-weight: 600;">${params.item}</p>
        <p style="margin: 0; color: #EF4444; font-size: 16px;">You owe: ${amountOwed}</p>
      </div>
      <p style="color: #64748B; font-size: 14px;">
        Your current balance: <span style="color: ${balanceColor}; font-weight: 600;">${balance}</span>
      </p>
    </div>
  `;
}

export async function sendExpenseNotifications(
  createdByName: string,
  item: string,
  chargedUsers: {
    userId: number;
    name: string;
    email: string | null;
    amountCents: number;
    balanceCents: number;
  }[]
) {
  if (!resend) {
    console.log("Resend not configured, skipping email notifications");
    return;
  }

  const emailPromises = chargedUsers
    .filter((u) => u.email && u.amountCents < 0)
    .map((user) =>
      resend.emails.send({
        from: "Big Brain Blockchain <notifications@pooltracker.app>",
        to: user.email!,
        subject: `[BBB] ${createdByName} added: ${item}`,
        html: buildEmailHtml({
          recipientEmail: user.email!,
          recipientName: user.name,
          createdByName,
          item,
          amountOwedCents: Math.abs(user.amountCents),
          currentBalanceCents: user.balanceCents,
        }),
      })
    );

  const results = await Promise.allSettled(emailPromises);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(`Failed to send ${failed.length} notification emails`);
  }
}
