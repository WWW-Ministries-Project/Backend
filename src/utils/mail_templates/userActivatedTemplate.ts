export const userActivatedTemplate = (mailDetails:any) => {
return `<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <title>Welcome to WWM Ministry</title>
</head>

<body style="font-family: Arial, sans-serif; background-color: #080D2D; padding: 20px; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width: 600px; margin: auto; background-color: #ffffff; padding: 20px; border-radius: 8px;">
        <tr>
            <td>
                <h2 style="color: #080D2D; text-align: center;">WWM Ministry</h2>
                <h3 style="color: #333333;">Hi ${mailDetails.user_name},</h3>
                <p style="font-size: 16px; color: #555555;">
                    Welcome to <strong>WWM Ministry</strong>! Your account has been successfully activated, and you're
                    all set to get started.
                </p>
                <p style="font-size: 16px; color: #555555;">
                    Click the button below to reset your password from the default password to something more secure and
                    personal. This will help keep your account safe and secure.
                </p>
                <p style="text-align: center; margin: 30px 0;">
                    <a href="${mailDetails.link}"
                        style="background-color: #080D2D; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; font-size: 16px; display: inline-block;">
                        Reset Password
                    </a>
                </p>
                <!-- <p style="font-size: 14px; color: #999999;">
                    If you have any questions or need help, feel free to reply to this email—we’re here for you.
                </p> -->
                <p style="font-size: 16px; color: #555555;">Blessings,<br><strong>WWM Ministry Team</strong></p>
            </td>
        </tr>
    </table>
</body>

</html>`

}