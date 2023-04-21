import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className="no-scrollbar">
        <Main />
        <NextScript />
        <script defer src="https://terminal.jup.ag/main-v1.js" data-preload />
      </body>
    </Html>
  );
}
