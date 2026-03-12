export default function AccountDeletionPage() {
  return (
    <main style={{
      maxWidth: "800px",
      margin: "40px auto",
      padding: "20px",
      fontFamily: "system-ui, sans-serif",
      lineHeight: "1.6"
    }}>
      <h1>JRide Account Deletion</h1>

      <p>
        If you would like to request deletion of your JRide account and all
        associated data, please contact us using the email below.
      </p>

      <h3>Request account deletion</h3>

      <p>
        Email: <b>info@jride.net</b>
      </p>

      <p>
        Please include the following in your email:
      </p>

      <ul>
        <li>Your registered phone number or email address</li>
        <li>Your JRide account name (if available)</li>
        <li>A short request stating that you want your account deleted</li>
      </ul>

      <h3>What happens next</h3>

      <p>
        Once your request is verified, the JRide team will permanently delete
        your account and associated data from our systems.
      </p>

      <p>
        Some records related to completed transactions may be retained where
        required for legal or financial compliance.
      </p>

      <hr />

      <p>
        JRide Corporation<br/>
        Ifugao, Philippines
      </p>
    </main>
  );
}