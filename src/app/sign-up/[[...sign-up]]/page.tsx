import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6f8] px-4 py-10">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
        appearance={{
          elements: {
            cardBox: "shadow-xl",
            formButtonPrimary: "bg-[#009b8f] hover:bg-[#087f76]"
          }
        }}
      />
    </main>
  );
}
