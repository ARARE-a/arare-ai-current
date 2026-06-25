import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6f8] px-4 py-10">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
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
