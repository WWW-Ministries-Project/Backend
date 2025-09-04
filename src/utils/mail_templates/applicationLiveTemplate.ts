export const applicationLiveTemplate = (
  loginLink: string,
  guestLink: string,
  itContact: string,
  name: string,
  email: string,
) => {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>PA25 Apparel Ordering Guide</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f9f9f9;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 650px;
        margin: 30px auto;
        background: #ffffff;
        border-radius: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        padding: 30px;
        line-height: 1.6;
        color: #333;
      }
      h2 {
        color: #2c3e50;
        margin-bottom: 20px;
      }
      ul {
        padding-left: 20px;
      }
      a {
        color: #3498db;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .footer {
        margin-top: 40px;
        font-size: 14px;
        color: #777;
        border-top: 1px solid #eee;
        padding-top: 15px;
        text-align: center;
      }
      .section-title {
        font-weight: bold;
        margin-top: 25px;
        color: #2c3e50;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>👕 PA25 APPAREL ORDERING GUIDE</h2>
      <p>Dear <strong>${name}</strong>,</p>

      <p>Kindly note that there are two different links, one for <strong>Registered WWM Members</strong> and one for <strong>Non-Registered WWM Members</strong>. Please follow the right guide depending on your status.</p>

      <div class="section-title">🔹 For Registered WWM Members</div>
      <ol>
        <li>Use this link: <a href="${loginLink}">${loginLink}</a></li>
        <li>Log in with:
          <ul>
            <li>Email: <strong>${email}</strong> (same email used when registering)</li>
            <li>Password: <strong>123456</strong></li>
          </ul>
        </li>
        <li>Once logged in, click on the 3 dots at the top beside the WWM logo.</li>
        <li>Select <strong>Marketplace</strong> to view the displayed PA25 apparels (T-shirts, jerseys, hoodies, etc.).</li>
        <li>Click <strong>View Product</strong> on the item you want.</li>
        <li>Fill in the required details, add your item(s) to the cart, and proceed to payment.
          <br>• You may edit or adjust your order in the cart before finalizing payment.
        </li>
      </ol>

      <div class="section-title">🔹 For Non-Registered WWM Members</div>
      <ol>
        <li>Use this link: <a href="${guestLink}">${guestLink}</a></li>
        <li>No login is required.</li>
        <li>Browse the PA25 apparels available.</li>
        <li>Click <strong>View Product</strong> on the item you want.</li>
        <li>Enter your personal details, place your order, and proceed to payment.</li>
      </ol>

      <div class="section-title">🔹 Important Notes (For All)</div>
      <ul>
        <li>Your order is confirmed only after payment is made on the platform.</li>
        <li>No cash payments will be accepted. All payments must be done directly on the ordering platform.</li>
        <li>During the payment process, each person will receive an <strong>OTP code via SMS</strong> on their MOMO number used for the payment. They will need to input the OTP to complete the process.</li>
        <li>If you need further assistance or have any enquiries about the platform, kindly contact the <strong>Registry Head</strong> or the <a href="mailto:${itContact}">IT Department</a>.</li>
      </ul>

      <div class="footer">
        Best regards,<br>
        <strong>World Wide Word Ministries</strong>
      </div>
    </div>
  </body>
  </html>
  `;
};
