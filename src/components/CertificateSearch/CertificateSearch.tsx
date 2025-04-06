import { useState } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from '@/contexts/EthereumContext';
import CertificateNFTABI from '../../../artifacts/contracts/CertificateNFT.sol/CertificateNFT.json';

interface Certificate {
  id: string;
  name: string;
  institute: string;
  issueDate: number;
  certificateType: string;
  student: string;
  tokenURI: string;
  metadata?: any;
}

const CertificateSearch = () => {
  const { provider } = useEthereum();
  const [searchAddress, setSearchAddress] = useState('');
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const certificateNFTAddress = process.env.NEXT_PUBLIC_CERTIFICATE_NFT_ADDRESS || '';

  const isValidAddress = (address: string) => ethers.isAddress(address);

  const handleSearch = async () => {
    if (!provider || !isValidAddress(searchAddress)) {
      setError('Please enter a valid Ethereum address');
      return;
    }

    try {
      setIsLoading(true);
      setError('');
      setCertificates([]);

      const signer = await provider.getSigner();
      const contract = new ethers.Contract(
        certificateNFTAddress,
        CertificateNFTABI.abi,
        signer
      );

      // No authorization check — open for all users to view

      const certificateIds: bigint[] = await contract.getStudentCertificates(searchAddress);

      if (certificateIds.length === 0) {
        setCertificates([]);
        return;
      }

      const certificatesData = await Promise.all(
        certificateIds.map(async (id: bigint) => {
          const [name, institute, issueDate, certificateType, student] =
            await contract.getCertificateDetails(id);

          const tokenURI = await contract.tokenURI(id);
          let metadata = null;

          try {
            const metadataHash = tokenURI.replace('ipfs://', '');
            const response = await fetch(`https://ipfs.io/ipfs/${metadataHash}`);
            metadata = await response.json();
          } catch (err) {
            console.error('Metadata fetch error:', err);
          }

          return {
            id: id.toString(),
            name,
            institute,
            issueDate: Number(issueDate),
            certificateType,
            student,
            tokenURI,
            metadata
          };
        })
      );

      setCertificates(certificatesData);
    } catch (err) {
      console.error('Search error:', err);
      setError('Something went wrong while fetching certificates.');
    } finally {
      setIsLoading(false);
    }
  };

  const convertIpfsUrl = (url: string) =>
    url.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${url.split('ipfs://')[1]}` : url;

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Search Certificates</h2>

      <div className="flex gap-4 mb-4">
        <input
          type="text"
          className="flex-1 p-2 border rounded"
          placeholder="Enter wallet address (0x...)"
          value={searchAddress}
          onChange={(e) => setSearchAddress(e.target.value)}
        />
        <button
          onClick={handleSearch}
          className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition"
          disabled={isLoading || !searchAddress}
        >
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {certificates.length > 0 ? (
        <div className="space-y-4">
          {certificates.map((cert) => (
            <div key={cert.id} className="border rounded-lg p-4 hover:bg-gray-50">
              <h3 className="font-bold text-lg">{cert.name}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <div>
                  <p><span className="font-medium">Institute:</span> {cert.institute}</p>
                  <p><span className="font-medium">Type:</span> {cert.certificateType}</p>
                  <p><span className="font-medium">Issued Date:</span> 
                    {new Date(cert.issueDate * 1000).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p><span className="font-medium">Student Address:</span></p>
                  <p className="text-sm text-gray-600 break-all">{cert.student}</p>
                </div>
              </div>

              {cert.metadata && (
                <div className="mt-4">
                  <a
                    href={convertIpfsUrl(cert.tokenURI)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    View Certificate Metadata
                  </a>

                  {cert.metadata.image && (
                    <div className="mt-2">
                      <p className="font-medium">Certificate Preview:</p>
                      <img
                        src={convertIpfsUrl(cert.metadata.image)}
                        alt="Certificate preview"
                        className="mt-2 max-w-xs rounded-lg shadow"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        !isLoading && searchAddress && (
          <p className="text-gray-600">No certificates found for this address</p>
        )
      )}
    </div>
  );
};

export default CertificateSearch;
