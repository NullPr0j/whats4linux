import { useCallback, useEffect, useState } from "react"
import { PairPhone } from "../../wailsjs/go/api/Api"

export function LoginScreen({
  canvasRef,
  status,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  status?: string
}) {
  const [mode, setMode] = useState<"qr" | "phone">("qr")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [pairingCode, setPairingCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [copied, setCopied] = useState(false)
  const [timeLeft, setTimeLeft] = useState(160)

  // Countdown timer for pairing code expiration
  useEffect(() => {
    if (!pairingCode || timeLeft <= 0) return

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [pairingCode, timeLeft])

  const handleRequestCode = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault()
      if (!phoneNumber.trim()) {
        setErrorMessage("Please enter your phone number with country code (e.g. +1 555 123 4567)")
        return
      }

      setIsLoading(true)
      setErrorMessage("")
      setCopied(false)

      try {
        const code = await PairPhone(phoneNumber)
        setPairingCode(code)
        setTimeLeft(160) // Reset countdown timer
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        setErrorMessage(errMsg || "Failed to generate pairing code. Please try again.")
      } finally {
        setIsLoading(false)
      }
    },
    [phoneNumber],
  )

  const handleCopy = useCallback(() => {
    if (!pairingCode) return
    void navigator.clipboard.writeText(pairingCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }, [pairingCode])

  const handleSwitchMode = (newMode: "qr" | "phone") => {
    setMode(newMode)
    setErrorMessage("")
    if (newMode === "qr") {
      setPairingCode("")
    }
  }

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-light-secondary dark:bg-dark-bg p-4">
      <div className="w-full max-w-225 min-h-130 bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col md:flex-row overflow-hidden border border-gray-100 dark:border-gray-800">
        {/* LEFT INSTRUCTIONS */}
        <div className="flex-1 p-8 md:p-12 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/WhatsApp.svg/1022px-WhatsApp.svg.png"
                className="w-10 h-10"
                alt="WhatsApp Logo"
              />
              <h1 className="text-2xl font-light text-gray-800 dark:text-gray-100">
                Log in to WhatsApp
              </h1>
            </div>

            {mode === "qr" ? (
              <ol className="list-decimal pl-6 space-y-4 text-gray-600 dark:text-gray-400 text-base md:text-lg leading-relaxed">
                <li>Open WhatsApp on your phone</li>
                <li>
                  Tap <b className="font-semibold text-gray-800 dark:text-gray-200">Menu</b> (Android) or{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Settings</b> (iPhone)
                </li>
                <li>
                  Select{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Linked Devices</b> and tap{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Link a Device</b>
                </li>
                <li>Point your phone at this screen to capture the code</li>
              </ol>
            ) : (
              <ol className="list-decimal pl-6 space-y-4 text-gray-600 dark:text-gray-400 text-base md:text-lg leading-relaxed">
                <li>Open WhatsApp on your phone</li>
                <li>
                  Tap <b className="font-semibold text-gray-800 dark:text-gray-200">Menu</b> (Android) or{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Settings</b> (iPhone)
                </li>
                <li>
                  Select{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Linked Devices</b> and tap{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Link a Device</b>
                </li>
                <li>
                  Tap{" "}
                  <b className="font-semibold text-gray-800 dark:text-gray-200">Link with phone number instead</b>{" "}
                  (or tap the push notification) and enter the code
                </li>
              </ol>
            )}
          </div>

          <div className="mt-8 pt-4 border-t border-gray-100 dark:border-gray-800">
            {mode === "qr" ? (
              <button
                type="button"
                onClick={() => handleSwitchMode("phone")}
                className="text-[#008069] dark:text-[#00a884] font-medium hover:underline text-sm flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Link with phone number instead</span>
                <span>&rarr;</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSwitchMode("qr")}
                className="text-[#008069] dark:text-[#00a884] font-medium hover:underline text-sm flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>&larr;</span>
                <span>Link with QR code instead</span>
              </button>
            )}
          </div>
        </div>

        {/* RIGHT INTERACTION PANEL */}
        <div className="flex-1 p-8 md:p-12 flex flex-col items-center justify-center border-t md:border-t-0 md:border-l border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          {mode === "qr" ? (
            /* QR MODE */
            <div className="flex flex-col items-center justify-center">
              <div className="bg-white p-3 rounded-xl shadow-sm mb-6 border border-gray-100 dark:border-gray-700">
                <canvas ref={canvasRef} className="size-64" />
              </div>

              <p className="text-gray-500 dark:text-gray-400 text-center mb-3 text-sm">
                Scan this QR code with the WhatsApp app
              </p>

              <p className="text-xs font-semibold text-[#008069] dark:text-[#00a884] animate-pulse uppercase tracking-wider">
                {status || "Waiting for connection..."}
              </p>
            </div>
          ) : (
            /* PHONE PAIRING MODE */
            <div className="w-full max-w-sm flex flex-col items-center">
              {!pairingCode ? (
                /* STEP 1: ENTER PHONE NUMBER */
                <form onSubmit={handleRequestCode} className="w-full flex flex-col gap-4">
                  <div className="text-center mb-2">
                    <h2 className="text-lg font-medium text-gray-800 dark:text-gray-100">
                      Enter Phone Number
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Include country code (e.g. +1 555 123 4567 or +44...)
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-red-600 dark:text-red-400 text-xs leading-relaxed">
                      {errorMessage}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="phone-input"
                      className="text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      Phone number
                    </label>
                    <input
                      id="phone-input"
                      type="tel"
                      value={phoneNumber}
                      onChange={e => setPhoneNumber(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00a884] focus:border-transparent transition-all"
                      autoFocus
                      disabled={isLoading}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !phoneNumber.trim()}
                    className="w-full py-2.5 px-4 mt-2 bg-[#008069] hover:bg-[#00705c] dark:bg-[#00a884] dark:hover:bg-[#029676] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        <span>Generating code...</span>
                      </>
                    ) : (
                      <span>Next</span>
                    )}
                  </button>
                </form>
              ) : (
                /* STEP 2: DISPLAY 8-CHAR CODE */
                <div className="w-full flex flex-col items-center">
                  <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    Enter this code on your phone
                  </span>

                  {/* CODE DISPLAY */}
                  <div className="flex items-center gap-2 my-3">
                    {pairingCode.split("-").map((chunk, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                          {chunk.split("").map((char, charIdx) => (
                            <span
                              key={charIdx}
                              className="w-8.5 h-11 sm:w-9.5 sm:h-12 flex items-center justify-center bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700 rounded-lg text-lg sm:text-xl font-mono font-bold text-gray-900 dark:text-white shadow-xs select-all"
                            >
                              {char}
                            </span>
                          ))}
                        </div>
                        {idx === 0 && (
                          <span className="text-gray-400 dark:text-gray-500 font-bold text-lg">
                            -
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 mt-3">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="px-3.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <svg
                            className="w-3.5 h-3.5 text-green-600 dark:text-green-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.5"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <span className="text-green-600 dark:text-green-400 font-semibold">
                            Copied!
                          </span>
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-3.5 h-3.5 text-gray-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
                            <path
                              d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                              strokeWidth="2"
                            />
                          </svg>
                          <span>Copy code</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setPairingCode("")}
                      className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:underline cursor-pointer"
                    >
                      Change number
                    </button>
                  </div>

                  {/* EXPIRATION & REFRESH */}
                  <div className="mt-6 text-center">
                    {timeLeft > 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Code expires in{" "}
                        <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">
                          {formatCountdown(timeLeft)}
                        </span>
                      </p>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-xs text-red-500 dark:text-red-400 font-medium">
                          Code has expired
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRequestCode()}
                          disabled={isLoading}
                          className="px-4 py-1.5 bg-[#008069] hover:bg-[#00705c] dark:bg-[#00a884] text-white text-xs font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
                        >
                          {isLoading ? "Refreshing..." : "Request new code"}
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-xs font-semibold text-[#008069] dark:text-[#00a884] animate-pulse uppercase tracking-wider mt-6">
                    {status || "Waiting for phone confirmation..."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
