import nodemailer from "nodemailer";
import { config } from "dotenv";
import { WEBSITE_LINK } from "../config/variables";

import i18n from "../i18n";

config();

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
});

const baseTemplate = (content: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Zoxxo Email</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        .header {
            background-color: #000000;
            color: white;
            text-align: center;
            padding: 20px;
        }
        .content {
            padding: 30px;
        }
        .button {
            display: inline-block;
            background-color: #ff0000;
            color: white !important;
            text-decoration: none;
            padding: 10px 20px;
            border-radius: 5px;
            margin-top: 20px;
        }
        .button:hover {
            background-color: #cc0000;
        }
        .footer {
            background-color: #f8f8f8;
            text-align: center;
            padding: 10px;
            font-size: 12px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="${WEBSITE_LINK}/zoxxo-light.png" alt="zoxxo" style="width: 80px; height: 70px;">
            <h2>${i18n.t('zoxxo')}</h2>
        </div>
        <div class="content">
            ${content}
        </div>
    <div class="footer">
        <p>© zoxxo.io | TM and © ${new Date().getFullYear()} zoxxo Inc.</p>
        <p>
            <a href="${WEBSITE_LINK}/terms-of-service" style="color: #ff0000;">${i18n.t('terms-of-service')}</a> |
            <a href="${WEBSITE_LINK}/privacy-policy" style="color: #ff0000;">${i18n.t('privacy-policy')}</a>
        </p>
    </div>
    </div>
</body>
</html>

`;

export const sendHtmlMail = (options: {
  to: string;
  subject: string;
  html: string;
}): Promise<any> => {
  return new Promise((resolve, reject) => {
    transport.sendMail(
      {
        from: process.env.SMTP_EMAIL,
        to: options.to,
        subject: options.subject,
        html: options.html,
      },
      (error, info) => {
        if (error) {
          console.error("Error sending email:", error);
          reject(error);
        } else {
          console.log("Email sent:", info.response);
          resolve(info);
        }
      }
    );
  });
};

export const sendTextMail = (options: {
  to: string;
  subject: string;
  text: string;
}): Promise<any> =>
  transport.sendMail({
    from: process.env.SMTP_EMAIL,
    to: options.to,
    subject: options.subject,
    text: options.text,
  });

export const sendNewAccountMail = (
  options: {
    link: string;
    to: string;
    fullName: string;
  },
  lng?: string
): void => {
  const content = `
    <h2>${i18n.t('welcome')}, ${options.fullName}!</h2>
    <p>${i18n.t("welcome-and-thank-you-for-your-registration", { lng })}</p>
    <p>${i18n.t(
      "you-have-decided-for-our-free-plan-with-4-gb-of-storage-and-2-gb-transfer-size",
      { lng }
    )}</p>
    <p>${i18n.t("we-hope-to-offer-you-the-best-user-experience", { lng })}</p>
    <p>${i18n.t("we-look-forward-to-help-you-with-delivering-your-data", {
      lng,
    })}</p>
    <a href="${options.link}" class="button">${i18n.t("login-to-your-account", {
    lng,
  })}</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend")}</p>
  `;

  sendHtmlMail({
    ...options,
    subject: "Welcome to Zoxxo",
    html: baseTemplate(content),
  });
};

// export const sendPublicEmail = (
//   options: {
//     downloadLink: string;
//     to: string;
//     subject: string;
//   },
//   lng?: string
// ): void => {
//   const content = `
//     <h2>${i18n.t("diviertete-have-fun-my-friend", { lng })}</h2>
//     <p>${i18n.t("hola-my-friend", { lng })}</p>
//     <p>${i18n.t("some-interesting-people-paragraph", { lng })} ${i18n.t(
//     "you-can-download-it-right-now",
//     { lng }
//   )}</p>
//     <a href="${options.downloadLink}" class="button">Download</a>
//     <p style="margin-top: 30px;">${i18n.t("adios-my-friend", { lng })}</p>
//   `;

//   sendHtmlMail({
//     ...options,
//     html: baseTemplate(content),
//   });
// };

export const sendPublicEmail = (
  options: {
    downloadLink: string;
    to: string;
    subject: string;
  },
  lng?: string
) =>
  sendHtmlMail({
    ...options,
    html: `
      <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Zoxxo Email</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        .header {
            background-color: #000000;
            color: white;
            text-align: center;
            padding: 20px;
        }
        .content {
            padding: 30px;
        }
       .button {
    display: inline-block;
    background-color: #ff0000;
    color: white !important;
    text-decoration: none;
    padding: 10px 20px;
    border-radius: 5px;
    margin-top: 20px;
}
    .button:hover {
    background-color: #cc0000;
}
        .footer {
            background-color: #f8f8f8;
            text-align: center;
            padding: 10px;
            font-size: 12px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="${WEBSITE_LINK}/zoxxo-light.png" alt="zoxxo" style="width: 80px; height: 70px;">
            <h2>ZOXXO</h2>
        </div>
        <div class="content">
         <h2>${i18n.t("diviertete-have-fun-my-friend", { lng })}</h2>
    <p>${i18n.t("hola-my-friend", { lng })}</p>
    <p>${i18n.t("some-interesting-people-paragraph", { lng })} ${i18n.t(
      "you-can-download-it-right-now",
      { lng }
    )}</p>
    <a href="${options.downloadLink}" class="button">Download</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend", { lng })}</p>
        </div>
<<<<<<< HEAD
        <div class="footer">
            <p>© zoxxo.io | TM and © 2024 zoxxo Inc.</p>
             <p>
                <a href="${WEBSITE_LINK}/terms-of-service" style="color: #ff0000;">${i18n.t('terms-of-service')}</a> |
                <a href="${WEBSITE_LINK}/privacy-policy" style="color: #ff0000;">${i18n.t('privacy-policy')}</a>
            </p>
        </div>
=======
         <div class="footer">
        <p>© zoxxo.io | TM and © ${new Date().getFullYear()} zoxxo Inc.</p>
        <p>
            <a href="${WEBSITE_LINK}/terms-of-service" style="color: #ff0000;">${i18n.t('terms-of-service')}</a> |
            <a href="${WEBSITE_LINK}/privacy-policy" style="color: #ff0000;">${i18n.t('privacy-policy')}</a>
        </p>
    </div>
>>>>>>> 9baf0c3403899889f8b928cf285b2244614f196d
    </div>
</body>
</html>
  `,
  });

export const sendNewUploadMail = (
  options: {
    downloadLink: string;
    to: string;
    fullName: string;
    fileName: string;
  },
  lng?: string
): void => {
  const content = `
    <h2>${i18n.t("buena-suerte-good-luck-my-friend", { lng })}</h2>
    <p>Hello ${options.fullName},</p>
    <p>${i18n.t("you-have-uploaded-a-new-file", {
      lng,
      filename: options.fileName,
    })}</p>
    <p>${i18n.t("you-can-share-it-right-now-with-others", { lng })}</p>
    <a href="${options.downloadLink}" class="button">${i18n.t("Download", {
    lng,
  })}</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend")}</p>
  `;

  sendHtmlMail({
    ...options,
    subject: "New file upload",
    html: baseTemplate(content),
  });
};

export const sendEmailChangeMail = (
  options: {
    link: string;
    to: string;
    fullName: string;
  },
  lng?: string
): void => {
  const content = `
    <h2>${i18n.t("no-se-preocupe-dont-worry-my-friend", { lng })}</h2>
    <p>Hello ${options.fullName},</p>
    <p>${i18n.t("you-want-to-change-your-email-address-to", {
      lng,
      to: options.to,
    })}</p>
    <p>${i18n.t("i-can-help-you-with-that", { lng })} ${i18n.t(
    "just-click-on-the-following-link-or-button-and-you-will-be-able-to-change-your-email-address",
    { lng }
  )}</p>
    <p>${i18n.t("remember-you-cant-do-this-so-often-my-friend", { lng })}</p>
    <a href="${options.link}" class="button">Change your email</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend", { lng })}</p>
  `;

  sendHtmlMail({
    ...options,
    subject: "Change your email",
    html: baseTemplate(content),
  });
};

export const sendPasswordResetMail = (
  options: {
    link: string;
    to: string;
    fullName: string;
  },
  lng?: string
): void => {
  const content = `
    <h2>${i18n.t("no-se-preocupe-dont-worry-my-friend", { lng })}</h2>
    <p>Hello ${options.fullName},</p>
    <p>${i18n.t("you-forgot-your-password-and-want-to-recover-now", {
      lng,
    })}</p>
    <p>${i18n.t("i-can-help-you-with-that", { lng })} ${i18n.t(
    "just-click-on-the-following-link-or-button-and-you-will-be-able-to-reset-your-password-write-it-down-somewhere-so-you-dont-forget-it-my-friend",
    { lng }
  )}</p>
    <a href="${options.link}" class="button">${i18n.t("change-your-password", {
    lng,
  })}</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend")}</p>
  `;

  sendHtmlMail({
    ...options,
    subject: "Reset your password",
    html: baseTemplate(content),
  });
};

export const sendEmailVerifcationMail = async (
  options: {
    link: string;
    to: string;
    fullName: string;
  },
  lng?: string
): Promise<void> => {
  const content = `
    <h2>${i18n.t("your-email-needs-verification", { lng })}</h2>
    <p>Hello ${options.fullName},</p>
    <p>${i18n.t("welcome-to-zoxxo", { lng })}</p>
    <p>${i18n.t(
      "please-verify-your-email-address-by-clicking-on-the-following-button",
      { lng }
    )}</p>
    <a href="${options.link}" class="button">${i18n.t("verify", { lng })}</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend")}</p>
  `;

  try {
    await sendHtmlMail({
      ...options,
      subject: "Verify your email",
      html: baseTemplate(content),
    });
   } catch (error) {
    console.error("Failed to send verification email:", error);
    throw error;
  }
};

export const sendPaymentMethodVerifcationMail = (
  options: {
    link: string;
    to: string;
    fullName: string;
  },
  lng?: string
): void => {
  const content = `
    <h2>${i18n.t(
      "your-card-verification-needs-some-actions-that-couldnt-be-completed",
      { lng }
    )}</h2>
    <p>Hello ${options.fullName},</p>
    <p>${i18n.t("we-have-noticed-you-tried-to-register-your-payment-method", {
      lng,
    })}</p>
    <p>${i18n.t(
      "unfortunately-we-couldnt-verify-it-due-to-some-authentication-or-banking-step",
      { lng }
    )}</p>
    <p>${i18n.t(
      "please-verify-your-payment-method-by-paying-a-test-amount-of-1-usd-after-successful-verification-it-will-be-refunded-you-can-follow-the-following-link",
      { lng }
    )}</p>
    <a href="${options.link}" class="button">${i18n.t(
    "verify-your-payment-method",
    { lng }
  )}</a>
    <p style="margin-top: 30px;">${i18n.t("adios-my-friend")}</p>
  `;

  sendHtmlMail({
    ...options,
    subject: "Verify your payment method",
    html: baseTemplate(content),
  });
};

export const sendEmailToUploader = (options: {
  to: string;
  content: string;
}): void => {
  sendTextMail({
    to: options.to,
    subject: "Upload Response",
    text: options.content,
  });
};

export default transport;
