export const forgetPasswordTemplate = (mailDetails: any) => {
  return `
    <!DOCTYPE html>
    <html>

    <head>
        <meta charset="UTF-8">
        <title>Password Reset</title>
    </head>

    <body style="font-family: Arial, sans-serif; background-color: #080D2D; padding: 20px; margin: 0;">
        <table width="100%" cellpadding="0" cellspacing="0"
            style="max-width: 600px; margin: auto; background-color: #ffffff; padding: 20px; border-radius: 8px;">
            <tr>
                <td>
                    <h2 style="color: #080D2D; text-align: center;">WWM Ministry</h2>
                    <h3 style="color: #333333;">Hi ${mailDetails.user_name},</h3>
                    <p style="font-size: 16px; color: #555555;">
                        We received a request to reset the password for your <strong>WWM Ministry</strong> account. If you
                        made this request, please click the button below to set a new password:
                    </p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="${mailDetails.link}"
                            style="background-color: #080D2D; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; font-size: 16px; display: inline-block;">
                            Reset Password
                        </a>
                    </p>
                    <p style="font-size: 14px; color: #999999;">
                        If you didn’t request a password reset, you can safely ignore this email. This link will expire in
                        ${mailDetails.expiration}.
                    </p>
                    <p style="font-size: 16px; color: #555555;">Thanks,<br><strong>WWM Ministry</strong></p>
                </td>
            </tr>
        </table>
    </body>

    </html>
`;
};
