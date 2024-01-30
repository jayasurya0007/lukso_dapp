// General
import React, { createContext, useContext, useEffect, useState } from 'react'
import { ethers } from 'ethers'

// Web3-Onboard
import Onboard, { OnboardAPI } from '@web3-onboard/core'
import injectedModule from '@web3-onboard/injected-wallets'
import luksoModule from '@lukso/web3-onboard-config'
import supportedNetworks from '../consts/SupportedNetworks.json'
import { config } from '../app/config'
import { ConnectModalOptions } from '@web3-onboard/core/dist/types'

// Sign In With Ethereum
import { SiweMessage } from 'siwe'
import UniversalProfileContract from '@lukso/lsp-smart-contracts/artifacts/UniversalProfile.json'

// Web3-Onboard: LUKSO provider initialization
const onboardLuksoProvider = luksoModule()

// Web3-Onboard: Set up injected interface
const injected = injectedModule({
  /**
   * Add other wallets here that you want to
   * inject into Web3-Onboard
   */
  custom: [onboardLuksoProvider],
  sort: (wallets) => {
    const sorted = wallets.reduce<any[]>((sorted, wallet) => {
      if (wallet.label === 'Universal Profiles') {
        sorted.unshift(wallet)
      } else {
        sorted.push(wallet)
      }
      return sorted
    }, [])
    return sorted
  },
  displayUnavailable: ['Universal Profiles'],
})

// Web3-Onboard: Set up App description
const onboardAppMetadata = {
  name: config.metadata.title,
  /**
   * Valid Image URL or SVG as string
   *
   * Icon shows behind the extension icon
   * on the right wallet side
   */
  icon: '/lukso_wordmark_black.svg',
  /**
   * Logo shows left of the provider
   * window, indicating the used app
   */
  logo: '/lukso_wordmark_fuchsia.svg',
  description: config.metadata.description,
  recommendedInjectedWallets: [
    {
      name: config.extension.name,
      url: config.extension.url,
    },
  ],
}

/**
 * Web3-Onboard: Set up the supported networks with strict
 * properties based on the supportedNetworks.json
 */
const onboardSupportedChains = supportedNetworks.map((network) => ({
  id: parseInt(network.chainId, 10),
  token: network.token,
  label: network.name,
  rpcUrl: network.rpcUrl,
}))

// Web3-Onboard: Set up Installation Notice
const onboardLuksoConnection: ConnectModalOptions = {
  iDontHaveAWalletLink: config.extension.url,
  removeWhereIsMyWalletWarning: true,
}

// Web3-Onboard: Create Onboard Component
const web3OnboardComponent: OnboardAPI = Onboard({
  wallets: [injected],
  chains: onboardSupportedChains,
  appMetadata: onboardAppMetadata,
  connect: onboardLuksoConnection,
})

// Regular provider setup
interface EthereumContextType {
  provider: ethers.BrowserProvider | null
  account: string | null
  connect: () => Promise<void>
  disconnect: () => void
  useOnboard: boolean
  toggleOnboard: () => void // Toggle between Web3-Onboard and regular provider
  signInWithEthereum: () => Promise<void>
  verified: boolean // Check if user is signed in
}

const defaultValue: EthereumContextType = {
  provider: null,
  account: null,
  connect: async () => {},
  disconnect: async () => {},
  useOnboard: true,
  toggleOnboard: () => {},
  signInWithEthereum: async () => {},
  verified: false,
}

// Set up the empty React context
const EthereumContext = createContext<EthereumContextType>(defaultValue)

/**
 * Custom hook to use the Ethereum context across the application.
 *
 * @returns {EthereumContextType} - The provider, account, and connect/disconnect functions.
 */
export function useEthereum() {
  return useContext(EthereumContext)
}

/**
 * Provider component for the Ethereum context, handling account connectivity and
 * maintaining its state during account and chain changes.
 *
 * @param {React.ReactNode} { children } - Child components using the Ethereum context.
 * @returns {JSX.Element} - The JSX structure that wraps the child components to provide
 *                          access to it's state and functionalities.
 */

export function EthereumProvider({ children }: { children: React.ReactNode }) {
  // State for the Ethereum provider and the connected account
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [account, setAccount] = useState<string | null>(null)

  // Adjust this state value to disable Web3-Onboard
  const [useOnboard, setUseOnboard] = useState(true)

  // Sign in with Ethereum
  const [verified, setVerified] = useState<boolean>(false)

  // Initialize the provider and listen for account/chain changes
  useEffect(() => {
    const updateAccountInfo = async (newAccount: string) => {
      setAccount(newAccount)
      if (typeof window !== 'undefined') {
        localStorage.setItem('ethereumAccount', newAccount) // save account to local storage
      }
    }

    // Load account from localStorage if available
    const storedAccount =
      typeof window !== 'undefined'
        ? localStorage.getItem('ethereumAccount')
        : null
    if (storedAccount) {
      updateAccountInfo(storedAccount)
    }
    /*
     * Check if the Universal Profile extension or regular
     * wallet injected the related window object
     */
    const providerObject = window.lukso || window.ethereum

    // Set global provider
    if (providerObject) {
      const provider = new ethers.BrowserProvider(providerObject)
      setProvider(provider)

      // Update address of the UP on profile swap
      providerObject.on('accountsChanged', (accounts: string[]) => {
        updateAccountInfo(accounts[0])
      })

      // Update address of the UP on chain swap
      providerObject.on('chainChanged', () => {
        /**
         * Clear the account from local storage and state
         * as smart contract address of UP will change
         */
        if (typeof window !== 'undefined') {
          localStorage.removeItem('ethereumAccount')
        }
        setAccount(null)
        setVerified(false)
      })
    } else {
      console.log('No wallet extension found')
    }
  }, [])

  // Connect to the Ethereum network using the user's extension
  const connect = async () => {
    // If Web3-Onboard is enabled
    if (useOnboard) {
      // Connection logic using web3-onboard
      const wallets = await web3OnboardComponent.connectWallet()
      if (wallets.length > 0) {
        const onboardProvider = new ethers.BrowserProvider(wallets[0].provider)
        setProvider(onboardProvider)
        setAccount(wallets[0].accounts[0].address)
      }
    }
    // Regular Connection
    else {
      if (!provider) {
        console.log('Provider is not set')
        return
      }
      try {
        const accounts = await provider.send('eth_requestAccounts', [])
        setAccount(accounts[0])
      } catch (error) {
        console.log('User denied connection request')
      }
    }
  }

  // Disconnect the provider by resetting the app's account
  const disconnect = () => {
    setAccount(null)
    setVerified(false)
  }

  // Toggle function
  const toggleOnboard = () => {
    setUseOnboard(!useOnboard)
  }

  // Sign In With Ethereum
  const signInWithEthereum = async () => {
    // SIWE requires an connected account
    if (!account || !provider) {
      console.log('No account connected')
      return
    }

    // Get chain ID of provider.
    const { chainId } = await provider.getNetwork()

    const siweMessage = new SiweMessage({
      domain: window.location.host,
      address: account,
      statement: 'By logging in you agree to the terms and conditions.',
      uri: window.location.origin,
      version: '1',
      chainId: Number(chainId),
      resources: ['https://boilerplate.lukso.tech'],
    })

    const message = siweMessage.prepareMessage()
    console.log('firstmessage:', message)
    const hashedMessage = ethers.hashMessage(message)

    try {
      const signer = await provider.getSigner()
      const signature = await signer.signMessage(message)

      // Create the UniversalProfile contract instance
      const myUniversalProfileContract = new ethers.Contract(
        account,
        UniversalProfileContract.abi,
        provider
      )

      const isValidSignature =
        await myUniversalProfileContract.isValidSignature(
          hashedMessage,
          signature
        )

      setVerified(isValidSignature === '0x1626ba7e')
    } catch (error) {
      console.error('Error on signing message: ', error)
    }
  }

  return (
    <EthereumContext.Provider
      value={{
        provider,
        account,
        connect,
        disconnect,
        useOnboard,
        toggleOnboard,
        signInWithEthereum,
        verified,
      }}
    >
      {children}
    </EthereumContext.Provider>
  )
}
