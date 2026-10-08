import { env } from "../config/env";

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends through Resend's HTTP API (no SDK / native deps, easy to swap for SES/Brevo).
 * Without RESEND_API_KEY (local dev) the mail is printed to the console instead.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.resendApiKey) {
    if (env.isProd) throw new Error("RESEND_API_KEY is not configured");
    console.log(`
[mail:dev] to=${mail.to} subject="${mail.subject}"
${mail.text}
`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.mailFrom, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#1c1c1e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#ff9933;padding:18px 24px;font-size:20px;font-weight:bold;color:#1c1c1e">जांगिड़ समाज · Jangid Samaj</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6">${inner}</td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationMail(name: string | null, link: string): Omit<Mail, "to"> {
  const who = esc(name ?? "");
  return {
    subject: "अपना ईमेल सत्यापित करें · Verify your email",
    html: layout(`<p>नमस्ते ${who},</p><p>जांगिड़ समाज पर आपका खाता बनाने के लिए नीचे दिए बटन से अपना ईमेल सत्यापित करें। यह लिंक 24 घंटे तक मान्य है।</p>
<p>Hi ${who}, please confirm your email to finish creating your account. This link is valid for 24 hours.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#ff9933;color:#1c1c1e;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">ईमेल सत्यापित करें · Verify email</a></p>
<p style="font-size:12px;color:#65676b">बटन न खुले तो यह लिंक ब्राउज़र में खोलें / If the button doesn't work, open this link:<br>${link}</p>
<p style="font-size:12px;color:#65676b">यदि आपने खाता नहीं बनाया, तो इस ईमेल को अनदेखा करें। · If you didn't sign up, ignore this email.</p>`),
    text: `नमस्ते ${name ?? ""}, अपना ईमेल सत्यापित करने के लिए यह लिंक खोलें (24 घंटे मान्य):
${link}

Hi, verify your email using this link (valid 24 hours):
${link}

If you didn't sign up, ignore this email.`,
  };
}

export function passwordResetMail(name: string | null, link: string): Omit<Mail, "to"> {
  const who = esc(name ?? "");
  return {
    subject: "पासवर्ड बदलें · Reset your password",
    html: layout(`<p>नमस्ते ${who},</p><p>आपके खाते का पासवर्ड बदलने का अनुरोध मिला है। नीचे दिए बटन से नया पासवर्ड बनाएं। यह लिंक 1 घंटे तक मान्य है।</p>
<p>Hi ${who}, we received a request to reset your password. This link is valid for 1 hour.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#ff9933;color:#1c1c1e;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">नया पासवर्ड बनाएं · Reset password</a></p>
<p style="font-size:12px;color:#65676b">बटन न खुले तो यह लिंक खोलें / If the button doesn't work, open:<br>${link}</p>
<p style="font-size:12px;color:#65676b">यदि यह अनुरोध आपने नहीं किया, तो इस ईमेल को अनदेखा करें — आपका पासवर्ड नहीं बदलेगा। · If you didn't ask for this, ignore this email.</p>`),
    text: `पासवर्ड बदलने के लिए यह लिंक खोलें (1 घंटा मान्य):
${link}

Reset your password using this link (valid 1 hour):
${link}

If you didn't ask for this, ignore this email.`,
  };
}

export function alreadyRegisteredMail(): Omit<Mail, "to"> {
  const link = `${env.appUrl}/login`;
  return {
    subject: "आपका खाता पहले से मौजूद है · You already have an account",
    html: layout(`<p>किसी ने इस ईमेल से साइन अप करने की कोशिश की, लेकिन इस पते पर खाता पहले से है।</p><p>Someone tried to sign up with this email, but an account already exists.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#ff9933;color:#1c1c1e;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block">लॉगिन · Log in</a></p>
<p style="font-size:12px;color:#65676b">यदि यह आप नहीं थे, तो कोई कार्रवाई आवश्यक नहीं है। · If this wasn't you, no action is needed.</p>`),
    text: `इस ईमेल पर खाता पहले से है। लॉगिन करें: ${link}
An account already exists for this email. Log in: ${link}`,
  };
}
