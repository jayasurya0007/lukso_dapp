import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { ethers } from 'ethers';
import UserRegistryABI from '../../artifacts/contracts/UserRegistry.sol/UserRegistry.json';
import CertificateNFTABI from '../../artifacts/contracts/CertificateNFT.sol/CertificateNFT.json';
import { useEthereum } from '@/contexts/EthereumContext';
import { uploadFileToIPFS, uploadJSONToIPFS } from '../../utils/ipfs';

export interface Certificate {
  id: string;
  name: string;
  institute: string;
  issueDate: number;
  certificateType: string;
  student: string;
  tokenURI: string;
  metadata?: any;
}

export interface RegisteredUser {
  address: string;
  role: string;
  metadataHash: string;
}

export interface CertificateRequest {
  id: number;
  student: string;
  name: string;
  message: string;
  studentMetadataHash: string;
  approved: boolean;
  institute: string;
}

export interface StudentMetadata {
  name: string;
  email: string;
  studentId: string;
  [key: string]: any;
}

export interface ProviderMetadata {
  institutionName: string;
  accreditationNumber: string;
  documentCid: string;
}

interface UserData {
  role: string;
  registered: boolean;
}

interface ContractContextType {
  // User Registry Functions
  getContract: (provider: any) => ethers.Contract | null;
  userData: UserData | null;
  loading: boolean;
  refetchUserData: () => void;
  getAllRegisteredUsers: () => Promise<RegisteredUser[]>;
  getRegisteredUser: (address: string) => Promise<RegisteredUser>;
  registerUser: (
    role: 'student' | 'provider',
    studentData?: { name: string; email: string; studentId: string },
    providerData?: { institutionName: string; accreditationNumber: string; document: File }
  ) => Promise<void>;

  // Certificate NFT Functions
  getCertificatesByAddress: (address: string) => Promise<Certificate[]>;
  checkIsOwner: (address: string) => Promise<boolean>;
  authorizeInstitute: (address: string) => Promise<void>;
  certificateNFTAddress: string;

  // Provider Dashboard Functions
  fetchProviderCertificateRequests: () => Promise<CertificateRequest[]>;
  fetchStudentMetadata: (studentAddress: string, metadataHash: string) => Promise<StudentMetadata | null>;
  fetchProviderMetadata: (address: string) => Promise<ProviderMetadata | null>;
  approveCertificateRequest: (
    requestId: number,
    certificateType: string,
    tokenURI: string,
    institutionName: string
  ) => Promise<void>;
  cancelCertificateRequest: (requestId: number) => Promise<void>;
  checkInstituteAuthorization: (address: string) => Promise<boolean>;

  // Student Dashboard Functions
  fetchStudentProfile: (address: string) => Promise<StudentMetadata | null>;
  requestCertificateIssuance: (providerAddress: string, certificateName: string, message: string) => Promise<void>;

  // New function to fetch pending providers
  fetchPendingProviders: () => Promise<RegisteredUser[]>;

  //search student by id
  getStudentByStudentId: (studentId: string) => Promise<{ address: string, metadata: StudentMetadata } | null>;

  //fetch all registered users(ownerdashboard)
  revokeInstitute: (instituteAddress: string) => Promise<void>;
  fetchAuthorizedProviders: () => Promise<RegisteredUser[]>;
}

interface ContractContextProviderProps {
  children: ReactNode;
}

const ContractContext = createContext<ContractContextType | null>(null);

export const ContractContextProvider = ({ children }: ContractContextProviderProps) => {
  const userRegistryAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '';
  const certificateNFTAddress = process.env.NEXT_PUBLIC_CERTIFICATE_NFT_ADDRESS || '';
  const { account, provider } = useEthereum();

  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Revoke institute authorization
  const revokeInstitute = async (instituteAddress: string): Promise<void> => {
    if (!provider || !account) throw new Error('Wallet not connected');
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, signer);

    // Verify ownership before proceeding
    const owner = await contract.owner();
    if (owner.toLowerCase() !== account.toLowerCase()) {
      throw new Error('You are not the contract owner');
    }

    const tx = await contract.revokeInstitute(instituteAddress);
    await tx.wait();
  };

  // Fetch authorized providers
  const fetchAuthorizedProviders = async (): Promise<RegisteredUser[]> => {
    if (!provider) return [];
    
    // Get all registered providers
    const allUsers = await getAllRegisteredUsers();
    const providers = allUsers.filter(user => user.role.toLowerCase() === 'provider');
  
    // Check authorization status
    const certContract = getCertificateContract(provider);
    if (!certContract) return [];
  
    const authorizedProviders = await Promise.all(
      providers.map(async (provider) => {
        const isAuthorized = await certContract.authorizedInstitutes(provider.address);
        return { ...provider, isAuthorized };
      })
    );
  
    return authorizedProviders.filter(provider => provider.isAuthorized);
  };

  //search student by id
  const getStudentByStudentId = async (studentId: string): Promise<{ address: string, metadata: StudentMetadata } | null> => {
    if (!provider) return null;
    
    try {
      const allUsers = await getAllRegisteredUsers();
      const students = allUsers.filter(user => user.role.toLowerCase() === 'student');
  
      for (const student of students) {
        try {
          const metadata = await fetchStudentMetadata(student.address, student.metadataHash);
          // Case-insensitive comparison
          if (metadata?.studentId?.toLowerCase() === studentId.toLowerCase()) {
            return { address: student.address, metadata };
          }
        } catch (error) {
          console.error(`Error fetching metadata for ${student.address}:`, error);
        }
      }
      return null;
    } catch (error) {
      console.error('Error searching for student:', error);
      return null;
    }
  };

  // User Registry contract instance getter
  const getContract = (provider: any): ethers.Contract | null => {
    if (!provider || !userRegistryAddress) return null;
    return new ethers.Contract(userRegistryAddress, UserRegistryABI.abi, provider);
  };

  // CertificateNFT contract instance getter
  const getCertificateContract = (provider: any): ethers.Contract | null => {
    if (!provider || !certificateNFTAddress) return null;
    return new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, provider);
  };

  // Fetch user data (role, registration)
  const fetchUserData = useCallback(async () => {
    if (account && provider) {
      setLoading(true);
      try {
        const contract = getContract(provider);
        if (!contract) throw new Error('User Registry contract not initialized');

        const [role] = await contract.getUser(account);
        const registered = await contract.isUserRegistered(account);
        setUserData({ role: role.toLowerCase(), registered });
      } catch (error) {
        console.error('Error fetching user data:', error);
        setUserData(null);
      } finally {
        setLoading(false);
      }
    }
  }, [account, provider]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  // Get all registered users
  const getAllRegisteredUsers = async (): Promise<RegisteredUser[]> => {
    if (!provider) throw new Error('Provider not available');
    const contract = getContract(provider);
    if (!contract) throw new Error('User Registry contract not initialized');

    const addresses: string[] = await contract.getAllUsers();
    return Promise.all(
      addresses.map(async (address) => {
        const [role, metadataHash] = await contract.getUser(address);
        return { address, role, metadataHash };
      })
    );
  };

  // Fetch all registered users (for admin dashboard)
  const fetchPendingProviders = async (): Promise<RegisteredUser[]> => {
    if (!provider) return [];
    
    // Get all registered providers
    const allUsers = await getAllRegisteredUsers();
    const providers = allUsers.filter(user => user.role.toLowerCase() === 'provider');
  
    // Check authorization status
    const certContract = getCertificateContract(provider);
    if (!certContract) return [];
  
    const pendingProviders = await Promise.all(
      providers.map(async (provider) => {
        const isAuthorized = await certContract.authorizedInstitutes(provider.address);
        return { ...provider, isAuthorized };
      })
    );
  
    return pendingProviders.filter(provider => !provider.isAuthorized);
  };

  // Get a registered user by address
  const getRegisteredUser = async (address: string): Promise<RegisteredUser> => {
    if (!provider) throw new Error('Provider not available');
    const contract = getContract(provider);
    if (!contract) throw new Error('User Registry contract not initialized');

    const [role, metadataHash] = await contract.getUser(address);
    return { address, role, metadataHash };
  };

  // Register user (student or provider)
  const registerUser = async (
    role: 'student' | 'provider',
    studentData?: { name: string; email: string; studentId: string },
    providerData?: { institutionName: string; accreditationNumber: string; document: File }
  ) => {
    if (!provider || !account) throw new Error('Please connect your wallet first');
    if (!userRegistryAddress) throw new Error('Contract address not configured');

    const signer = await provider.getSigner();
    const contract = new ethers.Contract(userRegistryAddress, UserRegistryABI.abi, signer);

    let metadata: any;

    if (role === 'student') {
      if (!studentData) throw new Error('Missing student data');
      metadata = {
        name: studentData.name,
        email: studentData.email,
        studentId: studentData.studentId,
      };
    } else {
      if (!providerData) throw new Error('Missing provider data');
      // Upload provider document to IPFS
      const docResponse = await uploadFileToIPFS(providerData.document);
      metadata = {
        institutionName: providerData.institutionName,
        accreditationNumber: providerData.accreditationNumber,
        documentCid: docResponse.cid,
      };
    }

    // Upload metadata to IPFS
    const { cid } = await uploadJSONToIPFS(metadata);
    if (!cid) throw new Error('Failed to upload metadata to IPFS');

    // Call contract to register user
    const tx = await contract.registerUser(role, cid);
    await tx.wait();

    await fetchUserData(); // Refresh user data after registration
  };

  // Get certificates by wallet address
  const getCertificatesByAddress = async (searchAddress: string): Promise<Certificate[]> => {
    if (!provider) throw new Error('Provider not available');
    const contract = getCertificateContract(provider);
    if (!contract) throw new Error('CertificateNFT contract not initialized');

    const certificateIds: bigint[] = await contract.getStudentCertificates(searchAddress);

    return Promise.all(
      certificateIds.map(async (id: bigint) => {
        const [name, institute, issueDate, certificateType, student] = await contract.getCertificateDetails(id);
        const tokenURI = await contract.tokenURI(id);

        let metadata = null;
        const metadataHash = tokenURI.replace('ipfs://', '');

        try {
          let response = await fetch(`https://gateway.pinata.cloud/ipfs/${metadataHash}`);
          if (!response.ok) throw new Error('Pinata fetch failed');
          metadata = await response.json();
        } catch (err) {
          console.warn('Pinata failed, trying ipfs.io:', err);
          try {
            const fallbackResponse = await fetch(`https://ipfs.io/ipfs/${metadataHash}`);
            if (!fallbackResponse.ok) throw new Error('ipfs.io fetch failed');
            metadata = await fallbackResponse.json();
          } catch (fallbackErr) {
            console.error('Metadata fetch error:', fallbackErr);
          }
        }

        return {
          id: id.toString(),
          name,
          institute,
          issueDate: Number(issueDate),
          certificateType,
          student,
          tokenURI,
          metadata,
        };
      })
    );
  };

  // Check if address is contract owner
  const checkIsOwner = async (address: string): Promise<boolean> => {
    if (!provider) return false;
    const contract = getCertificateContract(provider);
    if (!contract) return false;

    try {
      const owner = await contract.owner();
      return owner.toLowerCase() === address.toLowerCase();
    } catch (error) {
      console.error('Error checking ownership:', error);
      return false;
    }
  };

  // Authorize a new institute (only owner can call)
  const authorizeInstitute = async (instituteAddress: string): Promise<void> => {
    if (!provider || !account) throw new Error('Wallet not connected');
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, signer);

    // Verify ownership before proceeding
    const owner = await contract.owner();
    if (owner.toLowerCase() !== account.toLowerCase()) {
      throw new Error('You are not the contract owner');
    }

    const tx = await contract.authorizeInstitute(instituteAddress);
    await tx.wait();
  };

  // Provider Dashboard Functions
  const fetchProviderCertificateRequests = async (): Promise<CertificateRequest[]> => {
    if (!provider || !account) return [];
    
    try {
      const signer = await provider.getSigner();
      const certContract = new ethers.Contract(
        certificateNFTAddress,
        CertificateNFTABI.abi,
        signer
      );
  
      // Get total request count
      const requestCount: number = Number(await certContract.requestCounter());
      const requests: CertificateRequest[] = [];
  
      // Parallelize requests using Promise.all
      const requestPromises = Array.from({ length: requestCount }, (_, i) => i + 1)
        .map(async (requestId) => {
          try {
            const req = await certContract.certificateRequests(requestId);
            if (req.institute.toLowerCase() === account.toLowerCase() && !req.approved) {
              return {
                id: requestId,
                student: req.student,
                institute: req.institute,
                name: req.name,
                message: req.message,
                studentMetadataHash: req.studentMetadataHash,
                approved: req.approved,
              };
            }
          } catch (error) {
            console.error(`Error fetching request ${requestId}:`, error);
            return null;
          }
        });
  
      // Wait for all promises and filter valid requests
      const results = await Promise.all(requestPromises);
      return results.filter(Boolean) as CertificateRequest[];
  
    } catch (error) {
      console.error('Error fetching requests:', error);
      return [];
    }
  };

  const fetchStudentMetadata = async (studentAddress: string, metadataHash: string): Promise<StudentMetadata | null> => {
    if (!metadataHash) return null;
    try {
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${metadataHash}`);
      if (!response.ok) throw new Error('Pinata fetch failed');
      return await response.json();
    } catch {
      try {
        const fallbackResponse = await fetch(`https://ipfs.io/ipfs/${metadataHash}`);
        if (!fallbackResponse.ok) throw new Error('IPFS.io fetch failed');
        return await fallbackResponse.json();
      } catch {
        return null;
      }
    }
  };

  const fetchProviderMetadata = async (address: string): Promise<ProviderMetadata | null> => {
    if (!provider) return null;
    const signer = await provider.getSigner();
    const registryContract = new ethers.Contract(userRegistryAddress, UserRegistryABI.abi, signer);
    const [, metadataHash] = await registryContract.getUser(address);
    if (!metadataHash) return null;
    try {
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${metadataHash}`);
      if (!response.ok) throw new Error('Pinata fetch failed');
      return await response.json();
    } catch (err) {
      console.warn('Pinata failed, falling back to ipfs.io:', err);
      try {
        const fallbackResponse = await fetch(`https://ipfs.io/ipfs/${metadataHash}`);
        if (!fallbackResponse.ok) throw new Error('ipfs.io fetch failed');
        return await fallbackResponse.json();
      } catch (fallbackErr) {
        console.error('Metadata fetch failed on both gateways:', fallbackErr);
        return null;
      }
    }

    return null;
  };

  const approveCertificateRequest = async (
    requestId: number,
    certificateType: string,
    tokenURI: string,
    institutionName: string
  ): Promise<void> => {
    if (!provider || !account) throw new Error('Wallet not connected');
    const signer = await provider.getSigner();
    const certContract = new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, signer);
    const tx = await certContract.approveCertificateRequest(requestId, certificateType, tokenURI, institutionName);
    await tx.wait();
  };

  const cancelCertificateRequest = async (requestId: number): Promise<void> => {
    if (!provider || !account) throw new Error('Wallet not connected');
    const signer = await provider.getSigner();
    const certContract = new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, signer);
    const tx = await certContract.cancelCertificateRequest(requestId);
    await tx.wait();
  };

  const checkInstituteAuthorization = async (address: string): Promise<boolean> => {
    if (!provider) return false;
    const signer = await provider.getSigner();
    const certContract = new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, signer);
    return await certContract.authorizedInstitutes(address);
  };

  // *** New Student Dashboard Functions ***

  // Fetch student profile metadata from IPFS via UserRegistry contract
  const fetchStudentProfile = async (address: string): Promise<StudentMetadata | null> => {
    if (!provider) return null;
    try {
      const contract = getContract(provider);
      if (!contract) throw new Error('User Registry contract not initialized');
    
      const [, ipfsHash] = await contract.getUser(address);
      if (!ipfsHash) return null;
    
      let response = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
      if (!response.ok) {
        console.warn('Pinata failed, trying ipfs.io...');
        response = await fetch(`https://ipfs.io/ipfs/${ipfsHash}`);
        if (!response.ok) throw new Error('Both gateways failed to fetch profile metadata');
      }
    
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching student profile:', error);
      return null;
    }
  };

  // Request certificate issuance by calling certificateNFT contract
  const requestCertificateIssuance = async (
    providerAddress: string,
    certificateName: string,
    message: string
  ): Promise<void> => {
    if (!provider || !account) throw new Error('Wallet not connected');
    if (!certificateNFTAddress) throw new Error('CertificateNFT contract address not set');

    const signer = await provider.getSigner();
    const certContract = new ethers.Contract(certificateNFTAddress, CertificateNFTABI.abi, signer);

    // Fetch student's metadata hash for the request
    const contract = getContract(provider);
    if (!contract) throw new Error('User Registry contract not initialized');
    const [, studentMetadataHash] = await contract.getUser(account);

    // Call requestCertificate function on contract
    const tx = await certContract.requestCertificate(
      providerAddress,
      certificateName,
      message,
      studentMetadataHash
    );
    await tx.wait();
  };

  return (
    <ContractContext.Provider
      value={{
        getContract,
        userData,
        loading,
        refetchUserData: fetchUserData,
        getAllRegisteredUsers,
        getRegisteredUser,
        registerUser,
        getCertificatesByAddress,
        checkIsOwner,
        authorizeInstitute,
        certificateNFTAddress,
        fetchProviderCertificateRequests,
        fetchStudentMetadata,
        fetchProviderMetadata,
        approveCertificateRequest,
        cancelCertificateRequest,
        checkInstituteAuthorization,
        fetchStudentProfile,
        requestCertificateIssuance,
        fetchPendingProviders,
        getStudentByStudentId,
        revokeInstitute,
        fetchAuthorizedProviders,
      }}
    >
      {children}
    </ContractContext.Provider>
  );
};

export const useContractContext = (): ContractContextType => {
  const ctx = useContext(ContractContext);
  if (!ctx) throw new Error('useContractContext must be used within ContractContextProvider');
  return ctx;
};
