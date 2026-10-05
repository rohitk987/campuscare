/** Public institution information, checked against BMSIT's published pages on 5 October 2026. */
export default function BmsitInformation(){
 return <details className="bmsit-information">
  <summary>BMSIT campus information and contacts</summary>
  <div className="bmsit-information-body">
   <h2>BMS Institute of Technology &amp; Management</h2>
   <p>Doddaballapur Main Road, Avalahalli, Yelahanka, Bengaluru 560119.</p>
   <dl>
    <div><dt>College office</dt><dd><a href="tel:+918026146829">080-26146829</a></dd></div>
    <div><dt>Hostel enquiries</dt><dd><a href="tel:+919741590336">9741590336</a> · <a href="mailto:hostel@bmsit.in">hostel@bmsit.in</a></dd></div>
    <div><dt>IT services</dt><dd><a href="mailto:itcell@bmsit.in">itcell@bmsit.in</a></dd></div>
    <div><dt>Women helpline, 24 hours</dt><dd><a href="tel:+918026146852">080-26146852</a></dd></div>
   </dl>
   <p><strong>Published campus spaces:</strong> Academic Block, BSN Block, Labs Block, library, sports and gym facilities, and Boys Hostel A, B and C blocks.</p>
   <p>The girls’ hostel is in Yelahanka 4th phase, approximately 4 km from the main campus. It needs its own reporting area.</p>
   <p>Use the configured locations inside CampusCare when reporting. Published facility names and map markers do not establish reporting boundaries.</p>
   <nav aria-label="Official BMSIT information" className="bmsit-source-links">
    <a href="https://bmsit.ac.in/contact-details.php" target="_blank" rel="noopener noreferrer">Official contacts</a>
    <a href="https://bmsit.ac.in/network-infrastructure.php" target="_blank" rel="noopener noreferrer">Campus blocks and IT services</a>
    <a href="https://bmsit.ac.in/hostel-facilities.php" target="_blank" rel="noopener noreferrer">Hostel facilities</a>
    <a href="https://bmsit.ac.in/library-information-resource.php" target="_blank" rel="noopener noreferrer">Library</a>
    <a href="https://bmset.org/Facilities_bmsit.php" target="_blank" rel="noopener noreferrer">Sports and other facilities</a>
   </nav>
   <small>CampusCare is a student project. These are the college’s published contacts; they are not CampusCare support accounts. Information checked 5 October 2026.</small>
  </div>
 </details>;
}
